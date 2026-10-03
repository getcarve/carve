import AppKit
import ApplicationServices
import CoreGraphics
import CryptoKit
import Foundation
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers
import Vision

private let helperVersion = "0.2.0"

private struct Region: Codable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

private struct Command: Decodable {
    let action: String
    let sourcePath: String?
    let outputPath: String?
    let crop: Region?
    let screenshots: Bool?
    let activeWindow: Bool?
    let excludedApplications: [String]?
    let excludedWindows: [String]?
    let excludedRegions: [Region]?
    /// Process identifier of the Carve shell that spawned this helper, so
    /// Carve's own windows are never observed as if they were the user's work.
    let observerProcessIdentifier: Int32?
    /// Read on-screen text locally with Vision. Never enables input or control.
    let extractText: Bool?
    /// Read a bounded, read-only Accessibility snapshot of the focused window.
    let accessibilityTree: Bool?
    /// Exact hash of the last stored masked screenshot. When it matches, the
    /// helper returns before OCR or disk I/O.
    let previousScreenshotSha256: String?
    /// Used only by the long-running, memory-only adaptive probe process.
    let probeIntervalMilliseconds: Int?
}

private struct StatusResponse: Encodable {
    let ok = true
    let helperVersion: String
    let screenRecording: Bool
    let accessibility: Bool
    let adaptiveObservation = true
}

private struct ProbeResponse: Encodable {
    let ok = true
    let kind = "probe"
    let observedAtMs: Int64
    let app: String
    let bundleIdentifier: String
    let windowTitle: String
    let windowId: UInt32
    let width: Int
    let height: Int
    let excluded: Bool
    let exclusionReason: String?
    let selfObservation: Bool
    let waiting: Bool
    let meanDifference: Double
    let changedAreaRatio: Double
}

private struct ProbeState {
    let key: String
    let pixels: [UInt8]
}

private struct CaptureResponse: Encodable {
    let ok = true
    let app: String
    let bundleIdentifier: String
    let windowTitle: String
    let windowId: UInt32
    let width: Int
    let height: Int
    let screenshotWritten: Bool
    let screenshotSha256: String?
    let redactedRegionCount: Int
    let excluded: Bool
    let exclusionReason: String?
    let text: String?
    let textLineCount: Int
    let accessibility: [AccessibilityElementResponse]?
}

private struct AccessibilityElementResponse: Encodable {
    let role: String
    let name: String
    let identifier: String?
    let value: String?
    let bounds: Region?
    let sensitive: Bool
}

private struct SanitizeResponse: Encodable {
    let ok = true
    let width: Int
    let height: Int
    let screenshotSha256: String
    let redactedRegionCount: Int
}

private struct ErrorResponse: Encodable {
    let ok = false
    let error: String
}

/// A deliberate no-op, reported as success. Skips must never reach the caller
/// as a helper failure, because a failed capture pauses the whole session.
private struct RecognizeResponse: Encodable {
    let ok = true
    let text: String
    let textLineCount: Int
}

private struct SkipResponse: Encodable {
    let ok = true
    let skipped: String
}

@main
private enum CarveCaptureHelper {
    static func main() async {
        do {
            let input = FileHandle.standardInput.readDataToEndOfFile()
            guard input.count <= 1_000_000 else { throw CaptureError.invalidRequest("Request exceeds 1 MB") }
            let command = try JSONDecoder().decode(Command.self, from: input)
            switch command.action {
            case "status":
                write(StatusResponse(
                    helperVersion: helperVersion,
                    screenRecording: CGPreflightScreenCaptureAccess(),
                    accessibility: AXIsProcessTrusted()
                ))
            case "requestScreenPermission":
                _ = CGRequestScreenCaptureAccess()
                write(StatusResponse(
                    helperVersion: helperVersion,
                    screenRecording: CGPreflightScreenCaptureAccess(),
                    accessibility: AXIsProcessTrusted()
                ))
            case "capture":
                write(try await capture(command))
            case "observe":
                try await observe(command)
            case "sanitize":
                write(try sanitize(command))
            case "recognize":
                write(try recognize(command))
            default:
                throw CaptureError.invalidRequest("Unknown action")
            }
        } catch CaptureError.selfObservation {
            write(SkipResponse(skipped: "self_observation"))
        } catch CaptureError.duplicate {
            write(SkipResponse(skipped: "duplicate"))
        } catch {
            write(ErrorResponse(error: String(describing: error)))
            Foundation.exit(1)
        }
    }

    /// Long-running adaptive monitor. It emits only bounded change scores and
    /// window metadata. The downscaled probe image never leaves this process,
    /// is never encoded, and is replaced on the next sample.
    private static func observe(_ command: Command) async throws {
        guard CGPreflightScreenCaptureAccess() else { throw CaptureError.permissionDenied }
        let interval = max(250, min(5_000, command.probeIntervalMilliseconds ?? 500))
        var previous: ProbeState?
        while true {
            do {
                let next = try await probe(command, previous: previous)
                previous = next.state
                write(next.response)
            } catch CaptureError.selfObservation {
                previous = nil
                write(waitingProbe(selfObservation: true))
            } catch CaptureError.noFrontmostWindow {
                previous = nil
                write(waitingProbe(selfObservation: false))
            }
            try await Task.sleep(nanoseconds: UInt64(interval) * 1_000_000)
        }
    }

    private static func waitingProbe(selfObservation: Bool) -> ProbeResponse {
        ProbeResponse(
            observedAtMs: Int64(Date().timeIntervalSince1970 * 1_000),
            app: "", bundleIdentifier: "", windowTitle: "", windowId: 0,
            width: 0, height: 0, excluded: false, exclusionReason: nil,
            selfObservation: selfObservation, waiting: true,
            meanDifference: 0, changedAreaRatio: 0
        )
    }

    private static func probe(_ command: Command, previous: ProbeState?) async throws -> (response: ProbeResponse, state: ProbeState?) {
        let frontmost = NSWorkspace.shared.frontmostApplication
        let appName = frontmost?.localizedName ?? "[Unknown application]"
        let bundleIdentifier = frontmost?.bundleIdentifier ?? ""
        let processIdentifier = frontmost?.processIdentifier ?? 0
        if let observer = command.observerProcessIdentifier, observer != 0, observer == processIdentifier {
            throw CaptureError.selfObservation
        }
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let window = selectFrontmostWindow(content.windows, processIdentifier: processIdentifier) else {
            throw CaptureError.noFrontmostWindow
        }
        let windowTitle = window.title ?? "[Untitled window]"
        let excludedReason: String?
        if let match = matching(appName, in: command.excludedApplications ?? []) {
            excludedReason = "application:\(match)"
        } else if let match = matching(windowTitle, in: command.excludedWindows ?? []) {
            excludedReason = "window:\(match)"
        } else {
            excludedReason = nil
        }
        if let excludedReason {
            return (ProbeResponse(
                observedAtMs: Int64(Date().timeIntervalSince1970 * 1_000),
                app: appName, bundleIdentifier: bundleIdentifier, windowTitle: windowTitle,
                windowId: window.windowID, width: Int(window.frame.width.rounded()), height: Int(window.frame.height.rounded()),
                excluded: true, exclusionReason: excludedReason, selfObservation: false, waiting: false,
                meanDifference: 0, changedAreaRatio: 0
            ), nil)
        }

        let sourceWidth = max(1, Int(window.frame.width.rounded()))
        let sourceHeight = max(1, Int(window.frame.height.rounded()))
        let probeWidth = 64
        let probeHeight = max(1, min(64, Int((Double(sourceHeight) / Double(sourceWidth) * Double(probeWidth)).rounded())))
        let filter = SCContentFilter(desktopIndependentWindow: window)
        let configuration = SCStreamConfiguration()
        configuration.width = probeWidth
        configuration.height = probeHeight
        configuration.scalesToFit = true
        configuration.showsCursor = false
        configuration.ignoreShadowsSingleWindow = true
        let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration)
        let scaleX = Double(probeWidth) / Double(sourceWidth)
        let scaleY = Double(probeHeight) / Double(sourceHeight)
        var scaledRegions: [Region] = []
        for region in command.excludedRegions ?? [] {
            scaledRegions.append(Region(
                x: region.x * scaleX,
                y: region.y * scaleY,
                width: region.width * scaleX,
                height: region.height * scaleY
            ))
        }
        let masked = try redact(image, regions: scaledRegions)
        let pixels = try grayscalePixels(masked)
        let key = "\(bundleIdentifier)\u{0}\(window.windowID)\u{0}\(sourceWidth)x\(sourceHeight)"
        let metrics = previous?.key == key ? difference(previous?.pixels ?? [], pixels) : (1.0, 1.0)
        return (ProbeResponse(
            observedAtMs: Int64(Date().timeIntervalSince1970 * 1_000),
            app: appName, bundleIdentifier: bundleIdentifier, windowTitle: windowTitle,
            windowId: window.windowID, width: sourceWidth, height: sourceHeight,
            excluded: false, exclusionReason: nil, selfObservation: false, waiting: false,
            meanDifference: metrics.0, changedAreaRatio: metrics.1
        ), ProbeState(key: key, pixels: pixels))
    }

    private static func capture(_ command: Command) async throws -> CaptureResponse {
        guard CGPreflightScreenCaptureAccess() else { throw CaptureError.permissionDenied }
        let wantsScreenshot = command.screenshots ?? false
        let wantsWindow = command.activeWindow ?? true
        let wantsAccessibility = command.accessibilityTree ?? false
        guard wantsScreenshot || wantsWindow || wantsAccessibility else { throw CaptureError.invalidRequest("No observation signal was selected") }
        if wantsAccessibility && !AXIsProcessTrusted() { throw CaptureError.accessibilityPermissionDenied }

        let frontmost = NSWorkspace.shared.frontmostApplication
        let appName = frontmost?.localizedName ?? "[Unknown application]"
        let bundleIdentifier = frontmost?.bundleIdentifier ?? ""
        let processIdentifier = frontmost?.processIdentifier ?? 0
        if let observer = command.observerProcessIdentifier, observer != 0, observer == processIdentifier {
            throw CaptureError.selfObservation
        }
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let window = selectFrontmostWindow(content.windows, processIdentifier: processIdentifier) else {
            throw CaptureError.noFrontmostWindow
        }
        let windowTitle = window.title ?? "[Untitled window]"
        if let match = matching(appName, in: command.excludedApplications ?? []) {
            return excluded(appName: appName, bundleIdentifier: bundleIdentifier, windowTitle: windowTitle, window: window, reason: "application:\(match)")
        }
        if let match = matching(windowTitle, in: command.excludedWindows ?? []) {
            return excluded(appName: appName, bundleIdentifier: bundleIdentifier, windowTitle: windowTitle, window: window, reason: "window:\(match)")
        }
        let wantsText = command.extractText ?? false
        let accessibility = wantsAccessibility ? accessibilitySnapshot(processIdentifier: processIdentifier) : nil
        guard wantsScreenshot || wantsText else {
            return CaptureResponse(
                app: appName,
                bundleIdentifier: bundleIdentifier,
                windowTitle: windowTitle,
                windowId: window.windowID,
                width: Int(window.frame.width.rounded()),
                height: Int(window.frame.height.rounded()),
                screenshotWritten: false,
                screenshotSha256: nil,
                redactedRegionCount: 0,
                excluded: false,
                exclusionReason: nil,
                text: nil,
                textLineCount: 0,
                accessibility: accessibility
            )
        }
        var standardizedOutput = ""
        if wantsScreenshot {
            guard let outputPath = command.outputPath, outputPath.hasPrefix("/") else {
                throw CaptureError.invalidRequest("An absolute output path is required")
            }
            guard let captureRoot = ProcessInfo.processInfo.environment["STEWARD_CAPTURE_ROOT"] else {
                throw CaptureError.invalidRequest("Capture root is missing")
            }
            standardizedOutput = URL(fileURLWithPath: outputPath).standardizedFileURL.path
            let standardizedRoot = URL(fileURLWithPath: captureRoot).standardizedFileURL.path
            guard standardizedOutput.hasPrefix(standardizedRoot + "/") else {
                throw CaptureError.invalidRequest("Output path is outside the capture root")
            }
        }

        let filter = SCContentFilter(desktopIndependentWindow: window)
        let configuration = SCStreamConfiguration()
        configuration.width = max(1, Int(window.frame.width.rounded()))
        configuration.height = max(1, Int(window.frame.height.rounded()))
        configuration.scalesToFit = true
        configuration.showsCursor = false
        configuration.ignoreShadowsSingleWindow = true
        let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration)
        let regions = command.excludedRegions ?? []
        let redacted = try redact(image, regions: regions)

        var digest: String? = nil
        var encoded: Data? = nil
        if wantsScreenshot {
            let png = try pngData(redacted)
            digest = SHA256.hash(data: png).map { String(format: "%02x", $0) }.joined()
            if digest == command.previousScreenshotSha256 { throw CaptureError.duplicate }
            encoded = png
        }

        // Text is read from the masked image, never the original, and only
        // after exact-duplicate rejection, so a steady screen consumes neither
        // OCR time nor disk writes.
        var recognized: [String] = []
        if wantsText { recognized = recognizeText(in: redacted) }
        if let encoded { try encoded.write(to: URL(fileURLWithPath: standardizedOutput), options: .atomic) }
        return CaptureResponse(
            app: appName,
            bundleIdentifier: bundleIdentifier,
            windowTitle: windowTitle,
            windowId: window.windowID,
            width: redacted.width,
            height: redacted.height,
            screenshotWritten: wantsScreenshot,
            screenshotSha256: digest,
            redactedRegionCount: regions.filter { $0.width > 0 && $0.height > 0 }.count,
            excluded: false,
            exclusionReason: nil,
            text: wantsText ? recognized.joined(separator: "\n") : nil,
            textLineCount: recognized.count,
            accessibility: accessibility
        )
    }

    /// A deliberately bounded, read-only snapshot of the focused AX window.
    /// Secure fields and labels that look secret never contribute a value.
    private static func accessibilitySnapshot(processIdentifier: pid_t) -> [AccessibilityElementResponse] {
        let application = AXUIElementCreateApplication(processIdentifier)
        let root: AXUIElement
        if let focused = axAttribute(application, kAXFocusedWindowAttribute as CFString), CFGetTypeID(focused) == AXUIElementGetTypeID() {
            root = unsafeBitCast(focused, to: AXUIElement.self)
        } else {
            root = application
        }
        var output: [AccessibilityElementResponse] = []
        var visited = Set<CFHashCode>()

        func walk(_ element: AXUIElement, depth: Int) {
            guard depth <= 8, output.count < 300 else { return }
            let identity = CFHash(element)
            guard !visited.contains(identity) else { return }
            visited.insert(identity)

            let role = bounded(axString(element, kAXRoleAttribute as CFString) ?? "unknown", 80)
            let title = axString(element, kAXTitleAttribute as CFString)
                ?? axString(element, kAXDescriptionAttribute as CFString)
                ?? ""
            let identifier = axString(element, kAXIdentifierAttribute as CFString).map { bounded($0, 160) }
            let name = bounded(title, 240)
            let combined = "\(role) \(name) \(identifier ?? "")".lowercased()
            let sensitive = role == "AXSecureTextField"
                || ["password", "passcode", "secret", "token", "credit card", "social security", "private key"].contains { combined.contains($0) }
            let rawValue = sensitive ? nil : axString(element, kAXValueAttribute as CFString).map { bounded($0, 500) }
            let meaningful = role != "unknown" || !name.isEmpty || identifier != nil || rawValue != nil
            if meaningful {
                output.append(AccessibilityElementResponse(
                    role: role,
                    name: name,
                    identifier: identifier,
                    value: rawValue,
                    bounds: axBounds(element),
                    sensitive: sensitive
                ))
            }
            guard let children = axAttribute(element, kAXChildrenAttribute as CFString) as? [AXUIElement] else { return }
            for child in children.prefix(80) { walk(child, depth: depth + 1) }
        }

        walk(root, depth: 0)
        return output
    }

    private static func axAttribute(_ element: AXUIElement, _ attribute: CFString) -> CFTypeRef? {
        var value: CFTypeRef?
        return AXUIElementCopyAttributeValue(element, attribute, &value) == .success ? value : nil
    }

    /** An attribute that exists but carries no text is absent, not present —
     * otherwise the `AXTitle ?? AXDescription` fallback below never fires for
     * the many applications (Chromium among them) that publish an empty
     * AXTitle and the real label in AXDescription. See the fuller note in
     * CarveComputerHelper, whose identical bug left every live element
     * digest anonymous until 2026-08-25. */
    private static func axString(_ element: AXUIElement, _ attribute: CFString) -> String? {
        guard let value = axAttribute(element, attribute) else { return nil }
        if let string = value as? String { return string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : string }
        if let number = value as? NSNumber { return number.stringValue }
        return nil
    }

    private static func axBounds(_ element: AXUIElement) -> Region? {
        guard let rawPosition = axAttribute(element, kAXPositionAttribute as CFString), CFGetTypeID(rawPosition) == AXValueGetTypeID(),
              let rawSize = axAttribute(element, kAXSizeAttribute as CFString), CFGetTypeID(rawSize) == AXValueGetTypeID() else { return nil }
        let positionValue = unsafeBitCast(rawPosition, to: AXValue.self)
        let sizeValue = unsafeBitCast(rawSize, to: AXValue.self)
        var point = CGPoint.zero
        var size = CGSize.zero
        guard AXValueGetValue(positionValue, .cgPoint, &point), AXValueGetValue(sizeValue, .cgSize, &size), size.width > 0, size.height > 0 else { return nil }
        return Region(x: point.x, y: point.y, width: size.width, height: size.height)
    }

    private static func bounded(_ value: String, _ limit: Int) -> String {
        String(value.prefix(limit)).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func sanitize(_ command: Command) throws -> SanitizeResponse {
        guard let sourcePath = command.sourcePath, let outputPath = command.outputPath else {
            throw CaptureError.invalidRequest("Source and output paths are required")
        }
        let standardizedSource = try pathInsideCaptureRoot(sourcePath)
        let standardizedOutput = try pathInsideCaptureRoot(outputPath)
        guard standardizedSource != standardizedOutput else {
            throw CaptureError.invalidRequest("Sanitized output must not overwrite its source")
        }
        guard let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: standardizedSource) as CFURL, nil),
              let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
            throw CaptureError.invalidRequest("Source screenshot is unavailable or invalid")
        }
        let croppedImage = try crop(image, region: command.crop)
        let masks = command.excludedRegions ?? []
        let redacted = try redact(croppedImage, regions: masks)
        let png = try pngData(redacted)
        try png.write(to: URL(fileURLWithPath: standardizedOutput), options: .atomic)
        let digest = SHA256.hash(data: png).map { String(format: "%02x", $0) }.joined()
        return SanitizeResponse(
            width: redacted.width,
            height: redacted.height,
            screenshotSha256: digest,
            redactedRegionCount: masks.filter { $0.width > 0 && $0.height > 0 }.count
        )
    }

    private static func selectFrontmostWindow(_ windows: [SCWindow], processIdentifier: pid_t) -> SCWindow? {
        let candidates = windows.filter {
            $0.owningApplication?.processID == processIdentifier && $0.isOnScreen && $0.frame.width > 1 && $0.frame.height > 1
        }
        guard !candidates.isEmpty else { return nil }
        guard let raw = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else {
            return candidates.first
        }
        let orderedIds: [UInt32] = raw.compactMap { info in
            guard let ownerPid = info[kCGWindowOwnerPID as String] as? pid_t, ownerPid == processIdentifier,
                  let layer = info[kCGWindowLayer as String] as? Int, layer == 0,
                  let number = info[kCGWindowNumber as String] as? UInt32 else { return nil }
            return number
        }
        for identifier in orderedIds {
            if let match = candidates.first(where: { $0.windowID == identifier }) { return match }
        }
        return candidates.first
    }

    private static func redact(_ image: CGImage, regions: [Region]) throws -> CGImage {
        if regions.isEmpty { return image }
        let width = image.width
        let height = image.height
        guard let context = CGContext(
            data: nil,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else { throw CaptureError.encodingFailed }
        context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        context.setFillColor(NSColor.black.cgColor)
        for region in regions where region.width > 0 && region.height > 0 {
            let x = max(0, min(Double(width), region.x))
            let top = max(0, min(Double(height), region.y))
            let maskWidth = max(0, min(Double(width) - x, region.width))
            let maskHeight = max(0, min(Double(height) - top, region.height))
            let y = Double(height) - top - maskHeight
            context.fill(CGRect(x: x, y: y, width: maskWidth, height: maskHeight))
        }
        guard let result = context.makeImage() else { throw CaptureError.encodingFailed }
        return result
    }

    private static func crop(_ image: CGImage, region: Region?) throws -> CGImage {
        guard let region else { return image }
        guard region.x >= 0, region.y >= 0, region.width > 0, region.height > 0 else {
            throw CaptureError.invalidRequest("Crop must be a positive top-left pixel region")
        }
        let width = Double(image.width)
        let height = Double(image.height)
        guard region.x + region.width <= width, region.y + region.height <= height else {
            throw CaptureError.invalidRequest("Crop extends beyond the source screenshot")
        }
        let rect = CGRect(
            x: region.x,
            y: height - region.y - region.height,
            width: region.width,
            height: region.height
        ).integral
        guard let result = image.cropping(to: rect), result.width > 0, result.height > 0 else {
            throw CaptureError.encodingFailed
        }
        return result
    }

    private static func pathInsideCaptureRoot(_ path: String) throws -> String {
        guard path.hasPrefix("/") else { throw CaptureError.invalidRequest("An absolute capture path is required") }
        guard let captureRoot = ProcessInfo.processInfo.environment["STEWARD_CAPTURE_ROOT"] else {
            throw CaptureError.invalidRequest("Capture root is missing")
        }
        let standardizedPath = URL(fileURLWithPath: path).standardizedFileURL.path
        let standardizedRoot = URL(fileURLWithPath: captureRoot).standardizedFileURL.path
        guard standardizedPath.hasPrefix(standardizedRoot + "/") else {
            throw CaptureError.invalidRequest("Path is outside the capture root")
        }
        return standardizedPath
    }

    /// Reads text from a capture already on disk, so history recorded before
    /// recognition existed can be enriched without re-observing anything. Needs
    /// no Screen Recording permission: the pixels are already stored.
    private static func recognize(_ command: Command) throws -> RecognizeResponse {
        guard let sourcePath = command.sourcePath else {
            throw CaptureError.invalidRequest("A source path is required")
        }
        let standardizedSource = try pathInsideCaptureRoot(sourcePath)
        guard let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: standardizedSource) as CFURL, nil),
              let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
            throw CaptureError.invalidRequest("The capture could not be read")
        }
        let lines = recognizeText(in: image)
        return RecognizeResponse(text: lines.joined(separator: "\n"), textLineCount: lines.count)
    }

    private static let cyrillicRange: ClosedRange<UInt32> = 0x0400...0x04FF

    /// Cyrillic characters that are drawn identically to a Latin letter.
    ///
    /// Vision revision 3 reads Latin script with `cr_tr_model_latincyrillic_v3`,
    /// a single recognizer whose output alphabet covers both scripts, so it can
    /// return Cyrillic for Latin text no matter which languages the caller asks
    /// for. Measured on a stored capture: revision 3 rendered "(Top)" as "(Тор)"
    /// with three Cyrillic characters where revision 2 produced none. Those are
    /// different code points, so a search for "top" could never reach it.
    ///
    /// Only unambiguous lookalikes appear here. A Cyrillic character with no
    /// Latin twin — ж, ф, д — is evidence the word is genuinely Cyrillic.
    private static let homoglyphs: [Character: Character] = [
        "А": "A", "В": "B", "Е": "E", "К": "K", "М": "M", "Н": "H", "О": "O",
        "Р": "P", "С": "C", "Т": "T", "У": "Y", "Х": "X", "І": "I", "Ј": "J",
        "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x",
        "і": "i", "ј": "j", "ѕ": "s", "һ": "h",
    ]

    private static func containsCyrillic(_ value: String) -> Bool {
        value.unicodeScalars.contains { cyrillicRange.contains($0.value) }
    }

    /// Repairs Latin words the recognizer spelled in Cyrillic.
    ///
    /// Works token by token and refuses to touch a token holding any Cyrillic
    /// character without a Latin twin, so real Russian or Ukrainian text on
    /// screen survives exactly as recognized.
    private static func repairHomoglyphs(_ value: String) -> String {
        guard containsCyrillic(value) else { return value }
        let tokens = value.split(separator: " ", omittingEmptySubsequences: false)
        let repaired: [String] = tokens.map { token in
            var output = ""
            for character in token {
                guard let scalar = character.unicodeScalars.first,
                      character.unicodeScalars.count == 1,
                      cyrillicRange.contains(scalar.value) else {
                    output.append(character)
                    continue
                }
                guard let latin = homoglyphs[character] else { return String(token) }
                output.append(latin)
            }
            return output
        }
        return repaired.joined(separator: " ")
    }

    /// On-device Vision OCR. No network, no model download, no input access.
    /// Failure yields no text rather than failing the capture.
    private static func recognizeText(in image: CGImage) -> [String] {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        let handler = VNImageRequestHandler(cgImage: image, options: [:])
        do {
            try handler.perform([request])
        } catch {
            return []
        }
        guard let observations = request.results else { return [] }
        // Honour a caller that genuinely wants Cyrillic.
        let cyrillicRequested = request.recognitionLanguages.contains { language in
            ["ru", "uk", "bg", "sr", "mk", "be"].contains { language.lowercased().hasPrefix($0) }
        }

        var candidates: [String] = []
        for observation in observations {
            // A later candidate that avoids script mixing is better evidence
            // than repairing the first one, so it is preferred when offered.
            let options = observation.topCandidates(3)
            let chosen = cyrillicRequested
                ? options.first
                : options.first { !containsCyrillic($0.string) } ?? options.first
            guard let candidate = chosen else { continue }
            candidates.append(candidate.string)
            if candidates.count >= 400 { break }
        }

        // Repair only a page that is overwhelmingly Latin. A screen genuinely
        // showing Cyrillic is left completely alone, which is what protects the
        // narrow case the per-token rule cannot see on its own: a real Cyrillic
        // word spelled entirely from homoglyphs, like "сор", would otherwise be
        // Latinised into "cop".
        let joined = candidates.joined()
        let cyrillicCount = joined.unicodeScalars.filter { cyrillicRange.contains($0.value) }.count
        let letterCount = joined.unicodeScalars.filter { CharacterSet.letters.contains($0) }.count
        // A page genuinely written in Cyrillic is overwhelmingly Cyrillic, so the
        // threshold sits far from both ends rather than hugging zero: stray
        // look-alikes on an English page are a rounding error, and 2% turned out
        // to be tight enough to miss a short page carrying a single bad word.
        let latinPage = letterCount > 0 && Double(cyrillicCount) / Double(letterCount) < 0.15
        let repair = !cyrillicRequested && latinPage

        var lines: [String] = []
        for candidate in candidates {
            let text = repair ? repairHomoglyphs(candidate) : candidate
            let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
            if !value.isEmpty { lines.append(value) }
        }
        return lines
    }

    private static func pngData(_ image: CGImage) throws -> Data {
        let data = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(data, UTType.png.identifier as CFString, 1, nil) else {
            throw CaptureError.encodingFailed
        }
        CGImageDestinationAddImage(destination, image, nil)
        guard CGImageDestinationFinalize(destination) else { throw CaptureError.encodingFailed }
        return data as Data
    }

    private static func grayscalePixels(_ image: CGImage) throws -> [UInt8] {
        let width = image.width
        let height = image.height
        var pixels = [UInt8](repeating: 0, count: width * height)
        let rendered = pixels.withUnsafeMutableBytes { bytes -> Bool in
            guard let context = CGContext(
                data: bytes.baseAddress,
                width: width,
                height: height,
                bitsPerComponent: 8,
                bytesPerRow: width,
                space: CGColorSpaceCreateDeviceGray(),
                bitmapInfo: CGImageAlphaInfo.none.rawValue
            ) else { return false }
            context.interpolationQuality = .low
            context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
            return true
        }
        guard rendered else { throw CaptureError.encodingFailed }
        return pixels
    }

    private static func difference(_ before: [UInt8], _ after: [UInt8]) -> (Double, Double) {
        guard !before.isEmpty, before.count == after.count else { return (1, 1) }
        var total = 0
        var changed = 0
        for index in before.indices {
            let delta = abs(Int(before[index]) - Int(after[index]))
            total += delta
            if delta >= 24 { changed += 1 }
        }
        return (
            Double(total) / Double(before.count * 255),
            Double(changed) / Double(before.count)
        )
    }

    private static func matching(_ value: String, in patterns: [String]) -> String? {
        let normalized = value.lowercased()
        return patterns.first { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && normalized.contains($0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()) }
    }

    private static func excluded(appName: String, bundleIdentifier: String, windowTitle: String, window: SCWindow, reason: String) -> CaptureResponse {
        CaptureResponse(
            app: appName,
            bundleIdentifier: bundleIdentifier,
            windowTitle: windowTitle,
            windowId: window.windowID,
            width: Int(window.frame.width.rounded()),
            height: Int(window.frame.height.rounded()),
            screenshotWritten: false,
            screenshotSha256: nil,
            redactedRegionCount: 0,
            excluded: true,
            exclusionReason: reason,
            text: nil,
            textLineCount: 0,
            accessibility: nil
        )
    }

    private static func write<T: Encodable>(_ response: T) {
        let encoder = JSONEncoder()
        guard let data = try? encoder.encode(response) else { return }
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([0x0A]))
    }
}

private enum CaptureError: Error, CustomStringConvertible {
    case invalidRequest(String)
    case permissionDenied
    case accessibilityPermissionDenied
    case noFrontmostWindow
    case selfObservation
    case duplicate
    case encodingFailed

    var description: String {
        switch self {
        case .invalidRequest(let message): return "Invalid request: \(message)"
        case .permissionDenied: return "Screen Recording permission is not granted"
        case .accessibilityPermissionDenied: return "Accessibility permission is not granted"
        case .noFrontmostWindow: return "No capturable frontmost window is available"
        case .selfObservation: return "Carve is frontmost; nothing was captured"
        case .duplicate: return "The masked screenshot is an exact duplicate"
        case .encodingFailed: return "Screenshot encoding failed"
        }
    }
}
