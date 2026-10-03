import AppKit
import ApplicationServices
import CoreGraphics
import CryptoKit
import Foundation
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers

@_silgen_name("_AXUIElementGetWindow")
private func carvePrivateAXUIElementGetWindow(_ element: AXUIElement, _ identifier: UnsafeMutablePointer<CGWindowID>) -> AXError

private let helperVersion = "0.2.3"
private let captureProtocolVersion = 2
private let snapshotResponseLimit = 1_000_000
private let accessibilityByteLimit = 750_000
private let captureImageLimit = 25_000_000
/** Real pages expose over a thousand eligible elements; the digest keeps the
 * top-ranked ones. Goal terms from the request lift the controls a task
 * names above generic links, so deep navigation is not lost to the budget. */
private let captureElementLimit = 200
private let preferredTermPriority = 5_000
private let specificTermMatches = 40
/// Reserved preference term (see `goalPreferenceTerms`): any visible currency amount.
private let priceTerm = "#price"
/// Roles whose 1-px frame can be a real receiver, never treated as collapsed off-screen content.
/// A web <select> styled invisible behind a custom label (a retailer's "Sort by",
/// 131×1 px) is a real value chooser: the controller operates it through
/// accessibility by identity, never with the pointer, so its frame is kept.
private let collapsedFrameKeptRoles: Set<String> = ["AXTextField", "AXTextArea", "AXComboBox", "AXSearchField", "AXSecureTextField", "AXPopUpButton"]
/// Containers whose children are laid out inside them: skipped whole when entirely off-window.
private let offscreenPrunableRoles: Set<String> = ["AXGroup", "AXLink", "AXListItem", "AXList", "AXRow", "AXCell", "AXArticle"]
private let currencyAmountPattern = try! NSRegularExpression(pattern: #"[$€£¥₹]\s?\d|\d[\d.,]*\s?(?:usd|eur|gbp|dollars)\b"#, options: [])

private struct Point: Codable {
    let x: Double
    let y: Double
}

private struct Bounds: Codable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

private struct Target: Codable {
    let windowId: UInt32
    let application: String
    let bundleIdentifier: String
    let title: String
    let bounds: Bounds
}

private struct Input: Codable {
    let kind: String
    let point: Point?
    let scrollY: Double?
    let text: String?
    let textDelivery: String?
    let key: String?
}

private struct Command: Decodable {
    let ownedWindows: [CaptureWindow]?
    let action: String
    let target: Target?
    let outputPath: String?
    let input: Input?
    /** Snapshot only: skip the accessibility walk. Settle probes compare
     * pixels; they never bind actions, so they never need the digest. */
    let includeElements: Bool?
    /** Snapshot only: lowercase words from the approved goal; elements whose
     * label contains one outrank generic controls inside the element budget. */
    let preferTerms: [String]?
    let includeColor: Bool?
    let protocolVersion: Int?
    let requestId: String?
    let captureId: String?
    let responseByteLimit: Int?
    let elementByteLimit: Int?
    /** openWindow: the application to open a fresh window in, and, for a
     * browser, one https address to open it at. */
    let bundleIdentifier: String?
    let url: String?
}

private struct CaptureWindow: Decodable {
    let windowId: UInt32
    let bounds: Bounds
}

private struct InputViewport: Encodable {
    let x: Double
    let y: Double
    let parentBounds: Bounds
}

private struct WindowResult: Encodable {
    let ok = true
    let window: WindowResponse
    let appIcons: [String: String]
    let freshDocument: FreshDocumentReceipt?
}

private struct OkResponse: Encodable {
    let ok = true
}

private struct StatusResponse: Encodable {
    let ok = true
    let helperVersion: String
    let captureProtocols = [1, 2]
    let probeProtocols = [1]
    let screenRecording: Bool
    let accessibility: Bool
    let computerControl: Bool
}

private struct WindowResponse: Encodable {
    let windowId: UInt32
    let application: String
    let bundleIdentifier: String
    let title: String
    let bounds: Bounds
}

private struct WindowsResponse: Encodable {
    let ok = true
    let windows: [WindowResponse]
    let appIcons: [String: String]
}

private struct ApplicationIdentityResponse: Encodable {
    let application: String
    let bundleIdentifier: String
}

private struct ApplicationsResponse: Encodable {
    let ok = true
    let applications: [ApplicationIdentityResponse]
}

private struct DefaultApplicationResponse: Encodable {
    let capability: String
    let application: String
    let bundleIdentifier: String
    let basis: String
}

private struct DefaultApplicationsResponse: Encodable {
    let ok = true
    let defaults: [DefaultApplicationResponse]
}

private struct ElementResponse: Encodable {
    let role: String
    let subrole: String?
    let name: String
    let description: String?
    let help: String?
    let placeholder: String?
    let identifier: String?
    let value: String?
    var bounds: Bounds?
    let sensitive: Bool
    let focused: Bool?
    let containsFocus: Bool?
    let valueComplete: Bool?
    let enabled: Bool?
    let focusable: Bool?
    let editable: Bool?
    let selected: Bool?
    let expanded: Bool?
    let checked: Bool?
    let orientation: String?
    let minValue: Double?
    let maxValue: Double?
    let actions: [String]
    let settableAttributes: [String]
    let depth: Int
    let fingerprint: String
    /// Child indices from the walk root (`axRoot`), the same sibling indices
    /// the fingerprint chain hashes. The input bridge descends this path to
    /// act on exactly this element by identity, never by geometry.
    let axPath: [Int]
    let axRoot: String
    let dialogId: Int?
    var obstructed: Bool = false
    var pointerObstructions: [Bounds] = []
    let media: Bool
}

private struct ObstructionResponse: Encodable {
    let id: Int
    let role: String
    let subrole: String?
    let name: String
    var bounds: Bounds
    let evidence: String
}

private enum ElementCaptureStatus: String, Encodable {
    case available
    case axUntrusted = "ax_untrusted"
    case windowMatchFailed = "window_match_failed"
    case walkEmpty = "walk_empty"
    case notRequested = "not_requested"
}

private struct ElementCompleteness: Encodable {
    var visited = 0
    var eligible = 0
    var returned = 0
    var encodedBytes = 2
    var reasons: [String] = ["unavailable"]
}

private struct BinaryChannel: Encodable {
    let kind: String
    let captureId: String
    let byteLength: Int
    let width: Int
    let height: Int
    let pixelFormat: String
    let sha256: String
}

private struct WindowElementsResult {
    var elements: [ElementResponse]
    let status: ElementCaptureStatus
    let matchDiagnostics: WindowMatchDiagnostics
    /** Largest browser web area in window-relative points. This separates page
     * content from variable-height browser chrome without application-specific
     * toolbar constants. */
    var contentBounds: Bounds?
    var completeness = ElementCompleteness()
    var obstructions: [ObstructionResponse] = []
}

private struct WindowMatchCandidateDiagnostic: Encodable {
    let index: Int
    let iou: Double
    let positionDelta: Double
    let sizeDelta: Double
    let titleMatch: Bool
    let titleRelation: String
    let windowIdMatch: Bool?
    let score: Double
}

private struct WindowMatchDiagnostics: Encodable {
    let owningProcessId: Int32?
    let candidateCount: Int
    let acceptedCandidateIndex: Int?
    let uniqueBestMargin: Double?
    let selectionEvidence: String
    let candidates: [WindowMatchCandidateDiagnostic]
}

private struct SnapshotResponse: Encodable {
    var inputViewport: InputViewport? = nil
    let ok = true
    let width: Int
    let height: Int
    let sha256: String
    let visualSample: String
    let localizedVisualSample: String
    let annotationColorSample: String?
    let elements: [ElementResponse]
    let elementCaptureStatus: ElementCaptureStatus
    let elementMatchDiagnostics: WindowMatchDiagnostics
    let contentBounds: Bounds?
    var protocolVersion: Int? = nil
    var requestId: String? = nil
    var captureId: String? = nil
    var imageChannel: BinaryChannel? = nil
    var colorChannel: BinaryChannel? = nil
    var elementCompleteness: ElementCompleteness? = nil
    var obstructions: [ObstructionResponse] = []
    /** Where this process spent its time, in milliseconds: startup before the
     * request was decoded, then each snapshot phase. Diagnostics only. */
    var timingsMs: [String: Int]? = nil
}

/** Set before AppKit initialises, so request timings include process startup. */
private let helperProcessStarted = Date()
/** In serve mode, when the current request line arrived; timings start there. */
nonisolated(unsafe) private var helperRequestReceived: Date? = nil

private struct ProbeResponse: Encodable {
    let ok = true
    let protocolVersion = 1
    let requestId: String
    let windowId: UInt32
    let bundleIdentifier: String
    let width: Int
    let height: Int
    let visualSample: String
}

private struct PreparedInputResponse: Encodable {
    let ok = true
    let bounds: Bounds
}

private struct ActionResponse: Encodable {
    let ok = true
    let executed: String
}

private struct ErrorResponse: Encodable {
    let ok = false
    let error: String
    var errorCode: String? = nil
}

private enum ComputerError: Error, CustomStringConvertible {
    case invalidRequest(String)
    case permissionDenied(String)
    case targetUnavailable
    case captureChanged
    case focusChanged
    case protocolMismatch
    case outputLimit
    case launchFailed(String)

    var description: String {
        switch self {
        case .protocolMismatch: return "Unsupported capture protocol"
        case .outputLimit: return "Capture response exceeds its negotiated budget"
        case .invalidRequest(let message): return message
        case .permissionDenied(let message): return message
        case .targetUnavailable: return "The selected window is no longer available"
        case .captureChanged: return "The selected window group changed while capturing"
        case .launchFailed(let message): return message
        case .focusChanged: return "The selected application could not be focused; no input was sent"
        }
    }
}

@main
private enum CarveComputerHelper {
    @MainActor
    static func main() async {
        _ = helperProcessStarted
        // SCShareableContent can enumerate windows in a raw command-line
        // process, but SCContentFilter consults WindowServer display state.
        // Initialise the nested app's AppKit session on the main actor before
        // an async continuation constructs a filter; otherwise macOS aborts
        // inside SLSGetDisplaysWithRect with CGS_REQUIRE_INIT.
        _ = NSApplication.shared
        if CommandLine.arguments.contains("--serve") { await serve(); return }
        do {
            var data = Data()
            while let chunk = try FileHandle.standardInput.read(upToCount: min(16_384, 256_001 - data.count)), !chunk.isEmpty {
                data.append(chunk)
                if data.count > 256_000 { break }
            }
            guard data.count <= 256_000 else { throw ComputerError.invalidRequest("Request exceeds 256 KB") }
            let command = try JSONDecoder().decode(Command.self, from: data)
            switch command.action {
            case "status": write(status())
            case "requestScreenRecordingPermission":
                _ = CGRequestScreenCaptureAccess()
                write(status())
            case "requestAccessibilityPermission":
                let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
                _ = AXIsProcessTrustedWithOptions(options)
                write(status())
            case "listWindows": write(try await listWindows())
            case "listApplications": write(listApplications())
            case "listDefaultApplications": write(listDefaultApplications())
            case "openWindow": write(try await openWindow(command))
            case "closeWindow": write(try await closeWindow(command))
            case "snapshot": write(try await snapshot(command))
            case "probe": write(try await probe(command))
            case "prepareInput": write(try await prepareInput(command))
            case "execute": write(try await execute(command))
            default: throw ComputerError.invalidRequest("Unknown live computer action")
            }
        } catch {
            let code: String
            switch error {
            case ComputerError.permissionDenied: code = "permission_denied"
            case ComputerError.targetUnavailable: code = "target_unavailable"
            case ComputerError.captureChanged: code = "capture_changed"
            case ComputerError.protocolMismatch: code = "protocol_mismatch"
            case ComputerError.outputLimit: code = "output_limit"
            default: code = "process_error"
            }
            write(ErrorResponse(error: String(describing: error), errorCode: code))
            Foundation.exit(1)
        }
    }

    /**
     * Session-scoped observation mode: newline-delimited requests on stdin,
     * one newline-terminated JSON response each, binary channels on fds 3/4
     * exactly as in single-request mode (their lengths are in the response
     * descriptors). Observation only: snapshot, probe and status. Input,
     * window lifecycle and permission prompts stay one process per request.
     * A failed request answers with an error and the process keeps serving;
     * EOF on stdin ends it. Every request re-resolves its window and re-reads
     * its image and accessibility tree: nothing observed is reused.
     */
    private static func serve() async {
        var buffer = Data()
        func respond<T: Encodable>(_ value: T) {
            write(value)
            FileHandle.standardOutput.write(Data("\n".utf8))
        }
        while true {
            let line: Data
            if let newline = buffer.firstIndex(of: 0x0A) {
                line = buffer[buffer.startIndex..<newline]
                buffer = Data(buffer[buffer.index(after: newline)...])
            } else {
                // availableData returns whatever has arrived (empty at EOF);
                // read(upToCount:) would wait for a full buffer.
                let chunk = FileHandle.standardInput.availableData
                guard !chunk.isEmpty else { return }
                buffer.append(chunk)
                if buffer.count > 256_000 && buffer.firstIndex(of: 0x0A) == nil {
                    respond(ErrorResponse(error: "Request exceeds 256 KB", errorCode: "process_error")); return
                }
                continue
            }
            do {
                helperRequestReceived = Date()
                let command = try JSONDecoder().decode(Command.self, from: line)
                switch command.action {
                case "status": respond(status())
                case "snapshot": respond(try await snapshot(command))
                case "probe": respond(try await probe(command))
                default: throw ComputerError.invalidRequest("Only observation is served by a persistent helper")
                }
            } catch {
                let code: String
                switch error {
                case ComputerError.permissionDenied: code = "permission_denied"
                case ComputerError.targetUnavailable: code = "target_unavailable"
                case ComputerError.captureChanged: code = "capture_changed"
                case ComputerError.protocolMismatch: code = "protocol_mismatch"
                case ComputerError.outputLimit: code = "output_limit"
                default: code = "process_error"
                }
                respond(ErrorResponse(error: String(describing: error), errorCode: code))
            }
        }
    }

    private static func status() -> StatusResponse {
        let screenRecording = CGPreflightScreenCaptureAccess()
        let accessibility = AXIsProcessTrusted()
        return StatusResponse(
            helperVersion: helperVersion,
            screenRecording: screenRecording,
            accessibility: accessibility,
            computerControl: screenRecording && accessibility
        )
    }

    private static func listWindows() async throws -> WindowsResponse {
        try requireScreenRecording()
        let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true)
        let excludedBundleIdentifiers: Set<String> = [
            "com.apple.controlcenter",
            "com.apple.dock",
            "com.apple.notificationcenterui",
            "com.apple.WindowManager",
        ]
        var appIcons: [String: String] = [:]
        var includedWindowCount: [String: Int] = [:]
        var totalWindows = 0
        let windows = content.windows.compactMap { window -> WindowResponse? in
            guard totalWindows < 60, let application = window.owningApplication,
                  window.frame.width >= 120,
                  window.frame.height >= 80,
                  window.windowID != 0 else { return nil }
            let bundleIdentifier = application.bundleIdentifier
            guard !excludedBundleIdentifiers.contains(bundleIdentifier),
                  !bundleIdentifier.hasPrefix("app.carve.desktop") else { return nil }
            // One app with dozens of tabs or terminal windows must not crowd
            // every other useful application out of the picker.
            guard includedWindowCount[bundleIdentifier, default: 0] < 12 else { return nil }
            let rawTitle = bounded(window.title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "", 240)
            // Calculator, Stickies, and many utility apps run an untitled
            // document window at the normal window level. Dropping every
            // untitled window made such apps impossible to select at all
            // (seen in live testing); an untitled normal-level window is
            // listed under its application's own name instead. Untitled
            // windows on other levels (panels, overlays, tooltips) stay out.
            guard !rawTitle.isEmpty || window.windowLayer == 0 else { return nil }
            let title = rawTitle.isEmpty ? application.applicationName : rawTitle
            includedWindowCount[bundleIdentifier, default: 0] += 1
            totalWindows += 1
            if appIcons[bundleIdentifier] == nil,
               let icon = applicationIconDataURL(processIdentifier: application.processID) {
                if appIcons.values.reduce(0, { $0 + $1.utf8.count }) + icon.utf8.count <= 750_000 { appIcons[bundleIdentifier] = icon }
            }
            return WindowResponse(
                windowId: window.windowID,
                application: application.applicationName,
                bundleIdentifier: bundleIdentifier,
                title: title,
                bounds: bounds(window.frame)
            )
        }
        return WindowsResponse(windows: Array(windows.prefix(60)), appIcons: appIcons)
    }

    /** Exact, read-only LaunchServices identities for closed-app routing. No
     * document, account, window title, or file contents cross this boundary. */
    private static func listApplications() -> ApplicationsResponse {
        let manager = FileManager.default
        let roots = [
            URL(fileURLWithPath: "/Applications", isDirectory: true),
            URL(fileURLWithPath: "/System/Applications", isDirectory: true),
            // Modern macOS ships some system applications (notably Safari)
            // through a Cryptex and exposes only a symlink in /Applications.
            URL(fileURLWithPath: "/System/Cryptexes/App/System/Applications", isDirectory: true),
            URL(fileURLWithPath: "/System/Library/CoreServices/Applications", isDirectory: true),
            manager.homeDirectoryForCurrentUser.appendingPathComponent("Applications", isDirectory: true),
        ]
        var byBundle: [String: ApplicationIdentityResponse] = [:]
        func appendApplication(_ url: URL) {
            let resolvedURL = url.resolvingSymlinksInPath()
            guard let bundle = Bundle(url: resolvedURL),
                  let bundleIdentifier = bundle.bundleIdentifier?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !bundleIdentifier.isEmpty,
                  bundleIdentifier.count <= 240 else { return }
            let display = (bundle.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String)
                ?? (bundle.object(forInfoDictionaryKey: "CFBundleName") as? String)
                ?? url.deletingPathExtension().lastPathComponent
            let application = display.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !application.isEmpty, application.count <= 160 else { return }
            byBundle[bundleIdentifier] = ApplicationIdentityResponse(application: application, bundleIdentifier: bundleIdentifier)
        }
        // A selected running app may live outside the standard install roots.
        // Read bundle metadata only; never enumerate its windows or contents.
        // Prioritize regular running apps before applying the catalog bound.
        for application in NSWorkspace.shared.runningApplications where application.activationPolicy == .regular {
            if let url = application.bundleURL { appendApplication(url) }
            if byBundle.count >= 400 { break }
        }
        for root in roots where manager.fileExists(atPath: root.path) {
            if byBundle.count >= 400 { break }
            guard let enumerator = manager.enumerator(
                at: root,
                includingPropertiesForKeys: [.isApplicationKey],
                options: [.skipsHiddenFiles, .skipsPackageDescendants]
            ) else { continue }
            for case let url as URL in enumerator where url.pathExtension.lowercased() == "app" {
                appendApplication(url)
                if byBundle.count >= 400 { break }
            }
            if byBundle.count >= 400 { break }
        }
        return ApplicationsResponse(applications: byBundle.values.sorted {
            $0.application.localizedCaseInsensitiveCompare($1.application) == .orderedAscending
        })
    }

    /** Read-only macOS URL/content-type handlers. NSWorkspace supplies the
     * person's current system choice; this helper never calls a setter and
     * never reads a document or browser profile. */
    private static func listDefaultApplications() -> DefaultApplicationsResponse {
        let workspace = NSWorkspace.shared
        var defaults: [DefaultApplicationResponse] = []
        var seen = Set<String>()
        func append(_ capability: String, _ basis: String, _ applicationURL: URL?) {
            guard let applicationURL,
                  let bundle = Bundle(url: applicationURL.resolvingSymlinksInPath()),
                  let bundleIdentifier = bundle.bundleIdentifier?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !bundleIdentifier.isEmpty,
                  bundleIdentifier.count <= 240 else { return }
            let key = "\(capability):\(bundleIdentifier)"
            guard !seen.contains(key) else { return }
            let display = (bundle.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String)
                ?? (bundle.object(forInfoDictionaryKey: "CFBundleName") as? String)
                ?? applicationURL.deletingPathExtension().lastPathComponent
            let application = display.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !application.isEmpty, application.count <= 160 else { return }
            seen.insert(key)
            defaults.append(DefaultApplicationResponse(
                capability: capability,
                application: application,
                bundleIdentifier: bundleIdentifier,
                basis: basis
            ))
        }
        append("web_browser", "https_url", workspace.urlForApplication(toOpen: URL(string: "https://carve.invalid")!))
        append("text_document", "plain_text", workspace.urlForApplication(toOpen: UTType.plainText))
        append("spreadsheet", "spreadsheet", workspace.urlForApplication(toOpen: UTType.spreadsheet))
        append("presentation", "presentation", workspace.urlForApplication(toOpen: UTType.presentation))
        append("document_viewer", "pdf", workspace.urlForApplication(toOpen: UTType.pdf))
        return DefaultApplicationsResponse(defaults: defaults)
    }

    /**
     * Read the icon from the application that owns the window. Returning a
     * tiny PNG keeps the picker recognisable without shipping, downloading,
     * or trying to maintain a parallel catalogue of third-party brand marks.
     * Icons are keyed once per bundle in the response instead of repeated for
     * every browser window.
     */
    private static func windowIdentifiers(_ bundleIdentifier: String) async throws -> Set<UInt32> {
        // Activation can reveal hidden/minimized documents. Those are existing
        // windows, never newly created destinations.
        let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: false)
        return Set(content.windows.filter { $0.owningApplication?.bundleIdentifier == bundleIdentifier && $0.windowID != 0 }.map(\.windowID))
    }

    /** Never infer document creation from activation. TextEdit requires an
     * explicit New request and exact-window, empty, unsaved body evidence. */
    private static func openWindow(_ command: Command) async throws -> WindowResult {
        try requireScreenRecording()
        guard let bundleIdentifier = command.bundleIdentifier?.trimmingCharacters(in: .whitespacesAndNewlines), !bundleIdentifier.isEmpty, bundleIdentifier.count <= 240 else {
            throw ComputerError.invalidRequest("An application is required to open a fresh window")
        }
        guard let appURL = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleIdentifier) else {
            throw ComputerError.launchFailed("\(bundleIdentifier) is not installed on this Mac")
        }
        var url: URL? = nil
        if let raw = command.url?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty {
            guard raw.count <= 2_000, let parsed = URL(string: raw), parsed.scheme == "https", parsed.host != nil, parsed.user == nil, parsed.password == nil else {
                throw ComputerError.invalidRequest("A fresh browser window needs one complete https:// address")
            }
            url = parsed
        }
        var before = try await windowIdentifiers(bundleIdentifier)
        let requiresBlankDocument = bundleIdentifier == "com.apple.TextEdit"
        if requiresBlankDocument && !AXIsProcessTrusted() {
            throw ComputerError.permissionDenied("Accessibility is required to verify a new TextEdit document")
        }
        let wasRunning = !NSRunningApplication.runningApplications(withBundleIdentifier: bundleIdentifier).isEmpty
        let chromium = bundleIdentifier.range(of: "chrome|chromium|brave|edge|arc|vivaldi|opera", options: [.regularExpression, .caseInsensitive]) != nil
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        if let url {
            if chromium {
                // A running Chromium app ignores launch arguments; a second
                // instance forwards its command line to the first and exits.
                configuration.arguments = ["--new-window", url.absoluteString]
                configuration.createsNewApplicationInstance = wasRunning
                _ = try await NSWorkspace.shared.openApplication(at: appURL, configuration: configuration)
            } else {
                _ = try await NSWorkspace.shared.open([url], withApplicationAt: appURL, configuration: configuration)
            }
        } else {
            _ = try await NSWorkspace.shared.openApplication(at: appURL, configuration: configuration)
        }
        let started = Date()
        var newDocumentRequested = false
        var newDocumentRetried = false
        var unverifiedNewWindow = false
        var activationRetried = false
        // An app with many open windows re-raises all of them on activation
        // and creates its next document slowly (TextEdit with ~190 documents
        // took longer than the former fixed 8 s). The wait grows
        // with the window count, bounded so an app that never answers still
        // fails promptly.
        // In testing, TextEdit with 142 windows timed out twice in three tries at the former 24 s cap; the request timeout is 50 s.
        let deadline: TimeInterval = min(40, 8 + Double(before.count) / 8)
        while Date().timeIntervalSince(started) < deadline {
            try await Task.sleep(nanoseconds: 250_000_000)
            // LaunchServices may open a running app without making it the
            // foreground application. One explicit activation is authorized
            // by this fresh-window request. Never send New until focus is
            // independently observed, and never keep stealing focus.
            if url == nil && !newDocumentRequested && !activationRetried,
               Date().timeIntervalSince(started) > 1.5,
               NSWorkspace.shared.frontmostApplication?.bundleIdentifier != bundleIdentifier {
                activationRetried = true
                _ = NSRunningApplication.runningApplications(withBundleIdentifier: bundleIdentifier).first?.activate(options: [.activateIgnoringOtherApps])
                continue
            }
            let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true)
            // Front to back: the first new window of the app is the one it just raised.
            let candidates = content.windows.filter {
                let title = ($0.title ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                return $0.owningApplication?.bundleIdentifier == bundleIdentifier
                    && $0.windowID != 0
                    && !before.contains($0.windowID)
                    && (!requiresBlankDocument || newDocumentRequested)
                    && $0.frame.width >= 120 && $0.frame.height >= 80
                    // Native utilities such as Calculator expose a normal
                    // layer-zero window with no title. Freshness comes from
                    // the new window ID, not a decorative title; panels stay
                    // excluded by their nonzero layer. Browsers still need a
                    // title so a transient launcher surface cannot qualify.
                    && (url == nil ? $0.windowLayer == 0 : !title.isEmpty)
                    // A browser window titles itself after the page loads;
                    // "Untitled"/"New Tab" for the first second is not it yet.
                    && (url == nil || Date().timeIntervalSince(started) > 4 || !["untitled", "new tab"].contains(title.lowercased()))
            }
            // Two new windows of the same app during this wait means the
            // person opened one too (⌘N while Carve was launching its own).
            // Guessing could hand Carve the person's window, so refuse.
            if !requiresBlankDocument && candidates.count > 1 {
                throw ComputerError.launchFailed("Two new \(bundleIdentifier) windows opened at the same time; Carve will not guess which one is its own")
            }
            if let fresh = candidates.first {
                unverifiedNewWindow = true
                let documentReceipt = requiresBlankDocument
                    ? freshTextEditReceipt(fresh, excluded: before, newDocumentRequested: newDocumentRequested)
                    : nil
                // A restored document, unknown AX body, or saved file is not
                // ours. Do not return it, close it, or grant input authority.
                if requiresBlankDocument && documentReceipt == nil { continue }
                let icon = fresh.owningApplication.flatMap { applicationIconDataURL(processIdentifier: $0.processID) }
                return WindowResult(
                    window: WindowResponse(
                        windowId: fresh.windowID,
                        application: fresh.owningApplication?.applicationName ?? bundleIdentifier,
                        bundleIdentifier: bundleIdentifier,
                        title: bounded((fresh.title ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                            ? fresh.owningApplication?.applicationName ?? bundleIdentifier
                            : fresh.title!.trimmingCharacters(in: .whitespacesAndNewlines), 240),
                        bounds: bounds(fresh.frame)
                    ),
                    appIcons: icon.map { [bundleIdentifier: $0] } ?? [:],
                    freshDocument: documentReceipt
                )
            }
            // An already-running document app reactivates without a window;
            // its own New shortcut is the one universal way to ask for one.
            if url == nil && !newDocumentRequested && Date().timeIntervalSince(started) > 1.5,
               NSWorkspace.shared.frontmostApplication?.bundleIdentifier == bundleIdentifier {
                // Exclude windows restored/revealed by activation as well as
                // those that existed before launch. Snapshot before ⌘N.
                before.formUnion(try await windowIdentifiers(bundleIdentifier))
                guard NSWorkspace.shared.frontmostApplication?.bundleIdentifier == bundleIdentifier else { continue }
                newDocumentRequested = true
                // Carve's own request for a new document, sent only to the
                // application it just activated. It must not pass through
                // the model-facing keypress gate: that list deliberately
                // excludes CMD+N, and routing this through it made every
                // fresh TextEdit window fail with "Keypress is limited to
                // safe navigation keys" whenever TextEdit was already running
                // (seen in live testing).
                try postNewDocumentShortcut()
            }
            // One repeat of ⌘N halfway through: the first can be swallowed while
            // the app is still raising its windows after activation.
            if url == nil && newDocumentRequested && !newDocumentRetried && Date().timeIntervalSince(started) > deadline / 2,
               NSWorkspace.shared.frontmostApplication?.bundleIdentifier == bundleIdentifier {
                newDocumentRetried = true
                try postNewDocumentShortcut()
            }
        }
        throw ComputerError.launchFailed("\(bundleIdentifier) did not prove a fresh window within \(Int(deadline)) s (new requested: \(newDocumentRequested), candidate observed: \(unverifiedNewWindow), app focused: \(NSWorkspace.shared.frontmostApplication?.bundleIdentifier == bundleIdentifier))")
    }

    private static func freshTextEditReceipt(_ window: SCWindow, excluded: Set<UInt32>, newDocumentRequested: Bool) -> FreshDocumentReceipt? {
        guard let pid = window.owningApplication?.processID, NSWorkspace.shared.frontmostApplication?.processIdentifier == pid else { return nil }
        let application = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(application, 0.5)
        guard let raw = axAttribute(application, kAXFocusedWindowAttribute as CFString), CFGetTypeID(raw) == AXUIElementGetTypeID() else { return nil }
        let root = raw as! AXUIElement
        guard axWindowServerId(root) == Int64(window.windowID) else { return nil }
        var document: CFTypeRef?
        let documentStatus = AXUIElementCopyAttributeValue(root, kAXDocumentAttribute as CFString, &document)
        let noDocument = documentStatus == .noValue || documentStatus == .attributeUnsupported
            || (documentStatus == .success && (document as? String) == "")
        var bodies: [String?] = []
        var complete = true
        var visited = 0
        func walk(_ element: AXUIElement, _ depth: Int) {
            visited += 1
            guard visited <= 300, depth <= 20 else { complete = false; return }
            guard let role = axString(element, kAXRoleAttribute as CFString) else { complete = false; return }
            if role == "AXSheet" { complete = false; return }
            if role == "AXTextArea" {
                guard axAttributeIsSettable(element, kAXValueAttribute as CFString) == true else { complete = false; return }
                bodies.append(axTextValue(element))
            }
            var rawChildren: CFTypeRef?
            let status = AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &rawChildren)
            if status == .noValue || status == .attributeUnsupported { return }
            guard status == .success, let children = rawChildren as? [AXUIElement], children.count <= 300 else { complete = false; return }
            for child in children { walk(child, depth + 1); if !complete { return } }
        }
        walk(root, 0)
        return FreshDocumentPolicy.receipt(windowId: window.windowID, excluded: excluded,
            newDocumentRequested: newDocumentRequested, exactFocusedWindow: true,
            documentLocationAbsent: noDocument, complete: complete, editableBodies: bodies)
    }

    /** Closes one window Carve opened, through its own close button. Only the
     * caller's bookkeeping decides which windows qualify; this never guesses. */
    private static func closeWindow(_ command: Command) async throws -> OkResponse {
        try requireScreenRecording()
        guard AXIsProcessTrusted() else { throw ComputerError.permissionDenied("Accessibility is required to close a window") }
        guard let target = command.target else { throw ComputerError.invalidRequest("A window is required") }
        // A person may already have closed an owned window between attempts.
        if let descriptions = CGWindowListCopyWindowInfo(.optionIncludingWindow, target.windowId) as? [[String: Any]], descriptions.isEmpty {
            return OkResponse()
        }
        let window = try await resolve(target)
        guard let processIdentifier = window.owningApplication?.processID else { throw ComputerError.targetUnavailable }
        let application = AXUIElementCreateApplication(processIdentifier)
        AXUIElementSetMessagingTimeout(application, 0.5)
        guard let axWindow = matchAXWindow(application, window: window).element else { throw ComputerError.targetUnavailable }
        var rawButton: CFTypeRef?
        guard AXUIElementCopyAttributeValue(axWindow, kAXCloseButtonAttribute as CFString, &rawButton) == .success,
              let rawButton, CFGetTypeID(rawButton) == AXUIElementGetTypeID() else {
            throw ComputerError.invalidRequest("This window has no close button")
        }
        let button = rawButton as! AXUIElement
        guard AXUIElementPerformAction(button, kAXPressAction as CFString) == .success else {
            throw ComputerError.invalidRequest("The window did not close")
        }
        // AX success acknowledges the button press, not the window closing.
        // A sheet or unsaved-changes prompt may keep it alive. Never report
        // cleanup complete (or discard its owned identity) in that state.
        for _ in 0..<20 {
            try await Task.sleep(nanoseconds: 100_000_000)
            guard let windows = CGWindowListCopyWindowInfo(.optionAll, kCGNullWindowID) as? [[String: Any]] else {
                throw ComputerError.invalidRequest("Could not verify that the window closed")
            }
            if !windows.contains(where: { ($0[kCGWindowNumber as String] as? UInt32) == target.windowId }) {
                return OkResponse()
            }
        }
        throw ComputerError.invalidRequest("The window remains open; review its dialog before closing")
    }

    private static func applicationIconDataURL(processIdentifier: pid_t) -> String? {
        guard let application = NSRunningApplication(processIdentifier: processIdentifier),
              let bundleURL = application.bundleURL else { return nil }
        let source = NSWorkspace.shared.icon(forFile: bundleURL.path)
        let pointSize = NSSize(width: 32, height: 32)
        guard let bitmap = NSBitmapImageRep(
            bitmapDataPlanes: nil,
            pixelsWide: 64,
            pixelsHigh: 64,
            bitsPerSample: 8,
            samplesPerPixel: 4,
            hasAlpha: true,
            isPlanar: false,
            colorSpaceName: .deviceRGB,
            bytesPerRow: 0,
            bitsPerPixel: 0
        ) else { return nil }
        bitmap.size = pointSize
        guard let context = NSGraphicsContext(bitmapImageRep: bitmap) else { return nil }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = context
        context.imageInterpolation = .high
        source.draw(
            in: NSRect(origin: .zero, size: pointSize),
            from: NSRect(origin: .zero, size: source.size),
            operation: .copy,
            fraction: 1
        )
        context.flushGraphics()
        NSGraphicsContext.restoreGraphicsState()
        guard let png = bitmap.representation(using: .png, properties: [:]) else { return nil }
        return "data:image/png;base64,\(png.base64EncodedString())"
    }

    private static func captureWindowImage(_ window: SCWindow) async throws -> CGImage {
        let filter = SCContentFilter(desktopIndependentWindow: window)
        let configuration = SCStreamConfiguration()
        configuration.width = max(1, Int(window.frame.width.rounded()))
        configuration.height = max(1, Int(window.frame.height.rounded()))
        configuration.scalesToFit = true
        configuration.showsCursor = false
        configuration.ignoreShadowsSingleWindow = true
        return try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration)
    }

    // Desktop-independent capture fits attached sheets into the parent's
    // dimensions. Explicit window filters on displays preserve global points.
    // Membership comes from the native AX ownership reader, never the model.
    private static func captureWindowGroup(_ parent: SCWindow, members: [CaptureWindow]) async throws -> (CGImage, InputViewport) {
        guard !members.isEmpty, members.count <= 65, members.first?.windowId == parent.windowID,
              Set(members.map { $0.windowId }).count == members.count else {
            throw ComputerError.invalidRequest("Invalid owned-window capture group")
        }
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        var windows: [SCWindow] = []
        var rect = CGRect.null
        for member in members {
            let b = member.bounds
            guard [b.x,b.y,b.width,b.height].allSatisfy({ $0.isFinite }), b.width > 0, b.height > 0,
                  let window = content.windows.first(where: { $0.windowID == member.windowId }),
                  window.owningApplication?.processID == parent.owningApplication?.processID,
                  window.frame == CGRect(x:b.x,y:b.y,width:b.width,height:b.height) else {
                throw ComputerError.captureChanged
            }
            windows.append(window)
            rect = rect.union(window.frame)
        }
        let viewport = rect.integral
        let width = Int(viewport.width), height = Int(viewport.height)
        guard width > 0, height > 0, width <= 16384, height <= 16384, width * height <= 32_000_000,
              let canvas = CGContext(data:nil, width:width, height:height, bitsPerComponent:8, bytesPerRow:width*4,
                space:CGColorSpaceCreateDeviceRGB(), bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue) else {
            throw ComputerError.invalidRequest("Owned window viewport exceeds capture bounds")
        }
        let displays = content.displays.filter { $0.frame.intersects(viewport) }
        guard !displays.isEmpty, displays.count <= 16 else { throw ComputerError.invalidRequest("Owned viewport is not on screen") }
        for display in displays {
            let intersection = viewport.intersection(display.frame)
            let filter = SCContentFilter(display:display, including:windows)
            let configuration = SCStreamConfiguration()
            configuration.width = Int(display.frame.width)
            configuration.height = Int(display.frame.height)
            configuration.showsCursor = false
            configuration.ignoreShadowsDisplay = true
            if #available(macOS 14.2, *) { configuration.includeChildWindows = false }
            let full = try await SCScreenshotManager.captureImage(contentFilter:filter, configuration:configuration)
            guard full.width == configuration.width, full.height == configuration.height,
                  let part = full.cropping(to:intersection.offsetBy(dx:-display.frame.minX,dy:-display.frame.minY)) else {
                throw ComputerError.captureChanged
            }
            canvas.draw(part, in:CGRect(x:intersection.minX-viewport.minX, y:viewport.maxY-intersection.maxY,
                width:intersection.width,height:intersection.height))
        }
        // Reject a moved/resized/closed member instead of returning mixed geometry.
        let after = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly:true)
        guard windows.allSatisfy({ before in after.windows.contains(where: {
            $0.windowID == before.windowID && $0.frame == before.frame
                && $0.owningApplication?.processID == before.owningApplication?.processID
        }) }), let image = canvas.makeImage() else { throw ComputerError.captureChanged }
        let bounds = members[0].bounds
        return (image, InputViewport(x:viewport.minX-bounds.x, y:viewport.minY-bounds.y, parentBounds:bounds))
    }

    // Same selected-window capture and scale as a full frame, but no PNG,
    // disk, binary output, color sample, hashing or accessibility traversal.
    private static func probe(_ command: Command) async throws -> ProbeResponse {
        try requireScreenRecording()
        guard command.protocolVersion == 1, let target = command.target,
              let requestId = command.requestId, !requestId.isEmpty, requestId.utf8.count <= 240
        else { throw ComputerError.invalidRequest("Invalid visual probe request") }
        let window = try await resolve(target)
        let image = try await captureWindowImage(window)
        return ProbeResponse(requestId: requestId, windowId: window.windowID,
            bundleIdentifier: window.owningApplication?.bundleIdentifier ?? "",
            width: image.width, height: image.height,
            visualSample: try visualSample(image, width: 12, height: 12))
    }

    private static func snapshot(_ command: Command) async throws -> SnapshotResponse {
        var timings: [String: Int] = [:]
        var mark = Date()
        timings["startup"] = Int(mark.timeIntervalSince(helperRequestReceived ?? helperProcessStarted) * 1000)
        func phase(_ name: String) { let now = Date(); timings[name] = Int(now.timeIntervalSince(mark) * 1000); mark = now }
        try requireScreenRecording()
        guard let target = command.target else { throw ComputerError.invalidRequest("A selected window is required") }
        let v2 = command.protocolVersion == captureProtocolVersion
        guard command.protocolVersion == nil || command.protocolVersion == 1 || v2 else { throw ComputerError.protocolMismatch }
        if v2 {
            guard let captureId = command.captureId, !captureId.isEmpty, captureId.utf8.count <= 240,
                  let requestId = command.requestId, !requestId.isEmpty, requestId.utf8.count <= 240 else { throw ComputerError.invalidRequest("Missing capture identity") }
        }
        var legacyOutput: URL? = nil
        if !v2 {
            guard let outputPath = command.outputPath, outputPath.hasPrefix("/"),
                  let root = ProcessInfo.processInfo.environment["STEWARD_LIVE_CAPTURE_ROOT"] else { throw ComputerError.invalidRequest("Frame output is missing") }
            let outputURL = URL(fileURLWithPath: outputPath)
            guard outputURL.deletingLastPathComponent().resolvingSymlinksInPath().path == URL(fileURLWithPath: root).resolvingSymlinksInPath().path,
                  outputURL.pathExtension == "png" else { throw ComputerError.invalidRequest("Frame output is outside the live capture root") }
            legacyOutput = outputURL
        }
        let window = try await resolve(target)
        phase("resolve")
        let image: CGImage
        var inputViewport: InputViewport? = nil
        if let members = command.ownedWindows {
            guard v2 else { throw ComputerError.invalidRequest("Owned group capture requires protocol v2") }
            (image, inputViewport) = try await captureWindowGroup(window, members:members)
        } else { image = try await captureWindowImage(window) }
        phase("screenshot")
        let png = try pngData(image)
        phase("encode")
        guard png.count > 0, png.count <= captureImageLimit else { throw ComputerError.outputLimit }
        if let output = legacyOutput { try png.write(to: output, options: .atomic) }
        var elementCapture = command.includeElements == false
            ? WindowElementsResult(elements: [], status: .notRequested, matchDiagnostics: WindowMatchDiagnostics(owningProcessId: window.owningApplication?.processID, candidateCount: 0, acceptedCandidateIndex: nil, uniqueBestMargin: nil, selectionEvidence: "skipped", candidates: []), contentBounds: nil)
            : windowElements(window, byteLimit: min(accessibilityByteLimit, max(2, command.elementByteLimit ?? accessibilityByteLimit)), preferTerms: (command.preferTerms ?? []).prefix(24).map { $0.lowercased() }.filter { $0.count >= 3 && $0.count <= 40 })
        if command.includeElements == false { elementCapture.completeness.reasons = ["not_requested"] }
        phase("accessibility")
        if let viewport = inputViewport {
            // AX remains rooted in the selected document. Move its geometry
            // into the owned-group image; never read a sibling window's AX tree.
            func translate(_ bounds: Bounds) -> Bounds {
                Bounds(x: bounds.x - viewport.x, y: bounds.y - viewport.y, width: bounds.width, height: bounds.height)
            }
            let overlays = (command.ownedWindows ?? []).dropFirst().map { member in
                CGRect(x: member.bounds.x - window.frame.minX, y: member.bounds.y - window.frame.minY,
                       width: member.bounds.width, height: member.bounds.height)
            }
            for index in elementCapture.elements.indices {
                if let bounds = elementCapture.elements[index].bounds {
                    let rect = CGRect(x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height)
                    elementCapture.elements[index].pointerObstructions = overlays.filter { $0.intersects(rect) }.map { translate(Bounds(x: $0.minX, y: $0.minY, width: $0.width, height: $0.height)) }
                    elementCapture.elements[index].bounds = translate(bounds)
                }
            }
            if let bounds = elementCapture.contentBounds { elementCapture.contentBounds = translate(bounds) }
            for index in elementCapture.obstructions.indices {
                elementCapture.obstructions[index].bounds = translate(elementCapture.obstructions[index].bounds)
            }
        }

        let color = command.includeColor == false ? nil : try? colorSample(image)
        var response = SnapshotResponse(
            width: image.width,
            height: image.height,
            sha256: SHA256.hash(data: png).map { String(format: "%02x", $0) }.joined(),
            visualSample: try visualSample(image, width: 12, height: 12),
            localizedVisualSample: try visualSample(image, width: 96, height: 64),
            annotationColorSample: v2 ? nil : color?.base64EncodedString(),
            elements: elementCapture.elements,
            elementCaptureStatus: elementCapture.status,
            elementMatchDiagnostics: elementCapture.matchDiagnostics,
            contentBounds: elementCapture.contentBounds
        )
        phase("samples")
        timings["total"] = Int(Date().timeIntervalSince(helperRequestReceived ?? helperProcessStarted) * 1000)
        response.timingsMs = timings
        response.elementCompleteness = elementCapture.completeness
        response.inputViewport = inputViewport
        response.obstructions = elementCapture.obstructions
        if v2 {
            let captureId = command.captureId!
            response.protocolVersion = captureProtocolVersion
            response.requestId = command.requestId
            response.captureId = captureId
            response.imageChannel = binaryDescriptor(png, kind: "png", captureId: captureId, width: image.width, height: image.height, format: "png")
            if let color { response.colorChannel = binaryDescriptor(color, kind: "rgba", captureId: captureId, width: 192, height: 128, format: "rgba8") }
            // Check the complete serialized envelope before any binary output.
            let budget = min(snapshotResponseLimit, max(1, command.responseByteLimit ?? snapshotResponseLimit))
            guard try JSONEncoder().encode(response).count <= budget else { throw ComputerError.outputLimit }
            try FileHandle(fileDescriptor: 3, closeOnDealloc: false).write(contentsOf: png)
            if let color { try FileHandle(fileDescriptor: 4, closeOnDealloc: false).write(contentsOf: color) }
        }
        return response
    }

    private static func binaryDescriptor(_ data: Data, kind: String, captureId: String, width: Int, height: Int, format: String) -> BinaryChannel {
        BinaryChannel(kind: kind, captureId: captureId, byteLength: data.count, width: width, height: height, pixelFormat: format, sha256: SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined())
    }

    /**
     * Bounded, read-only Accessibility elements for the selected window only,
     * with window-relative geometry so they share the frame image's frame of
     * reference. Best-effort: a snapshot never fails because Accessibility is
     * denied or the AX window cannot be matched. A sensitive element (secure
     * field or credential-suggestive labeling) contributes structure only.
     */
    private static func windowElements(_ window: SCWindow, byteLimit: Int = accessibilityByteLimit, preferTerms: [String] = []) -> WindowElementsResult {
        guard AXIsProcessTrusted(), let processIdentifier = window.owningApplication?.processID else {
            return WindowElementsResult(elements: [], status: .axUntrusted, matchDiagnostics: WindowMatchDiagnostics(owningProcessId: window.owningApplication?.processID, candidateCount: 0, acceptedCandidateIndex: nil, uniqueBestMargin: nil, selectionEvidence: "none", candidates: []), contentBounds: nil)
        }
        let application = AXUIElementCreateApplication(processIdentifier)
        // A browser answering thousands of attribute reads while a page loads
        // can stall for seconds per call. Bound every call so the walk always
        // returns, with whatever it reached, inside its time budget.
        AXUIElementSetMessagingTimeout(AXUIElementCreateSystemWide(), 0.5)
        AXUIElementSetMessagingTimeout(application, 0.5)
        // Before the Sheets incident, Chromium never exposed its
        // tab or toolbar controls here and every pointer action became a pixel
        // guess. Chromium accepts one of these equivalent AX gates depending
        // on its release; other applications safely ignore unsupported keys.
        _ = AXUIElementSetAttributeValue(application, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue)
        _ = AXUIElementSetAttributeValue(application, "AXManualAccessibility" as CFString, kCFBooleanTrue)
        let match = matchAXWindow(application, window: window)
        let root: AXUIElement
        let matchDiagnostics: WindowMatchDiagnostics
        if let matched = match.element {
            root = matched
            matchDiagnostics = match.diagnostics
        } else if selectedWindowIsSoleNormalWindow(window) {
            // A few single-window utility apps expose their controls from the
            // application AX root but omit a matchable AXWindow. The exact
            // selected SCWindow is still the only visible normal window owned
            // by that process, so walking the app root cannot cross into an
            // unselected sibling. Geometry clipping below keeps only controls
            // that lie inside the selected frame.
            root = application
            matchDiagnostics = WindowMatchDiagnostics(
                owningProcessId: window.owningApplication?.processID,
                candidateCount: match.diagnostics.candidateCount,
                acceptedCandidateIndex: nil,
                uniqueBestMargin: match.diagnostics.uniqueBestMargin,
                selectionEvidence: "sole_normal_window",
                candidates: match.diagnostics.candidates
            )
        } else {
            return WindowElementsResult(elements: [], status: .windowMatchFailed, matchDiagnostics: match.diagnostics, contentBounds: nil)
        }
        var candidates: [(element: ElementResponse, priority: Int, matchedTerms: [Int])] = []
        var contentBounds: Bounds?
        var obstructions: [ObstructionResponse] = []
        var visited = Set<CFHashCode>()
        let walkDeadline = Date().addingTimeInterval(0.9)
        var truncation = Set<String>()
        // The owner and its ancestors are a relationship, not a rectangle
        // heuristic. Keep them even when the ordinary tree walk is bounded.
        var focusAncestors: [AXUIElement] = []
        if let rawFocus = axAttribute(application, kAXFocusedUIElementAttribute as CFString),
           CFGetTypeID(rawFocus) == AXUIElementGetTypeID() {
            var cursor: AXUIElement? = (rawFocus as! AXUIElement)
            for _ in 0..<40 {
                guard let current = cursor, Date() <= walkDeadline,
                      !focusAncestors.contains(where: { CFEqual($0, current) }) else { break }
                focusAncestors.append(current)
                guard let parent = axAttribute(current, kAXParentAttribute as CFString),
                      CFGetTypeID(parent) == AXUIElementGetTypeID() else { break }
                cursor = (parent as! AXUIElement)
            }
        }
        // A combobox that keeps DOM focus while an option is its
        // aria-activedescendant: Chrome reports the option as the application's
        // focused element (a flight-search page's origin box), yet keys
        // go to the combobox. The text field whose AXOwns list holds the focus
        // path is the keyboard receiver, by the platform's own ownership link.
        let focusedRole = focusAncestors.first.flatMap { axString($0, kAXRoleAttribute as CFString) }
        let ownerTextRoles = Set(["AXTextField", "AXTextArea", "AXComboBox", "AXSearchField"])
        let focusMayBeOwned = focusedRole.map { !ownerTextRoles.contains($0) } ?? false

        // On-screen first: a clothing retailer's filter sidebar follows ~100 product cards in document order, so a
        // document-order walk spent the 2,500-node budget on cards scrolled past and never visited the Brand facet
        // that was on screen. A subtree whose frame lies wholly outside the window is deferred and walked only with
        // the budget the on-screen walk leaves. Dialogs and the focus path are never deferred. STEWARD_AX_VISIBLE_FIRST=off.
        let visibleFirst = ProcessInfo.processInfo.environment["STEWARD_AX_VISIBLE_FIRST"] != "off"
        var activeDeadline = walkDeadline
        var deferred: [(element: AXUIElement, depth: Int, parentPath: String, sibling: Int, inheritedDialog: Int?, axPath: [Int], axRoot: String)] = []
        var walkingDeferred = false

        func walk(_ element: AXUIElement, depth: Int, parentPath: String, sibling: Int, inheritedDialog: Int?, axPath: [Int], axRoot: String) {
            // The deferred pass stopping at its own bound loses only off-screen content: not a coverage truncation.
            if Date() > activeDeadline { if !walkingDeferred { truncation.insert("time") }; return }
            // Walk broadly, then retain the most actionable visible nodes.
            // A first-N depth-first cut disproportionately kept containers and
            // discarded fields/buttons late in Chromium and complex native
            // trees. The encoded result remains bounded below.
            // Web content sits deep in a browser's tree and is wide; the caps
            // must reach a page's search field, not stop in the toolbar.
            guard depth <= 40 else { truncation.insert("depth"); return }
            guard visited.count < 2_500 else { truncation.insert("node"); return }
            let identity = CFHash(element)
            guard !visited.contains(identity) else { return }
            visited.insert(identity)
            prefetchAttributes(element)
            if visibleFirst, !walkingDeferred, depth >= 3, inheritedDialog == nil,
               !focusAncestors.contains(where: { CFEqual($0, element) }),
               // Off the window, or (lazily rendered cards, content-visibility) no frame at all: 2,000 of a retailer page's
               // 2,500 visited nodes had none. Frameless nodes are deferred only where the off-screen prune applies.
               axGlobalBounds(element).map({ !$0.intersects(window.frame) })
                ?? (depth >= 6 && offscreenPrunableRoles.contains(axString(element, kAXRoleAttribute as CFString) ?? "")) {
                visited.remove(identity)
                deferred.append((element, depth, parentPath, sibling, inheritedDialog, axPath, axRoot))
                return
            }

            let role = bounded(axString(element, kAXRoleAttribute as CFString) ?? "unknown", 80)
            let measured = axBool(element, "AXHidden" as CFString) == true ? nil : windowRelativeBounds(element, window: window.frame)
            // Chrome reports content scrolled off the page's top as a 1-px
            // strip pinned to the page edge (a clothing retailer's prices at y=87, 1 px tall;
            // a "Sort by" control at 131×1), so it looked on
            // screen. A collapsed frame is not visible content. Text entry and
            // the focus path keep theirs: an editor can type through a real
            // 1-px receiver (Google Docs' 625×1 text area).
            let collapsed = measured.map { $0.width <= 1 || $0.height <= 1 } ?? false
            let bounds = collapsed && !collapsedFrameKeptRoles.contains(role) && !focusAncestors.contains(where: { CFEqual($0, element) }) ? nil : measured
            // Long pages retain off-screen text nodes in AX. Reading all their
            // attributes exhausts the walk before reaching the viewport. A
            // leaf of text without visible geometry is not current evidence.
            if role == "AXStaticText" && bounds == nil { return }
            let subrole = axString(element, kAXSubroleAttribute as CFString).map { bounded($0, 80) }
            let title = axString(element, kAXTitleAttribute as CFString)
                ?? axString(element, kAXDescriptionAttribute as CFString)
                ?? ""
            let roleDescription = axString(element, kAXRoleDescriptionAttribute as CFString).map { bounded($0, 120) }
            let help = axString(element, kAXHelpAttribute as CFString).map { bounded($0, 160) }
            let placeholder = axString(element, kAXPlaceholderValueAttribute as CFString).map { bounded($0, 160) }
            let identifier = axString(element, kAXIdentifierAttribute as CFString).map { bounded($0, 160) }
            let name = bounded(title, 120)
            let combined = "\(name) \(placeholder ?? "") \(identifier ?? "")"
            let sensitive = CarveControlIsSensitive(role, subrole ?? "", combined)
            let textLimit = role == "AXStaticText" ? 4_000 : 500
            // Adjustable controls publish numbers, not text: a web number input
            // reports AXValue 6 as a CFNumber, and the segments of a web date or
            // time field carry their value only in AXValueDescription ("11",
            // "18", "2026"). Without these the controller could type a correct
            // value and still never read it back (widget probe).
            let completeValue = sensitive ? nil : (axTextValue(element) ?? (role == "AXStaticText" ? title : nil) ?? adjustableValue(element, role: role))
            let rawValue = completeValue.map { bounded($0, textLimit) }
            // Geometry and values are deliberately absent: scrolling, typing,
            // and animation must not turn the same control into a new identity.
            let identityParts = [parentPath, role, sensitive ? "" : (identifier ?? ""), sensitive ? "" : name, String(sibling)]
            let identityData = (try? JSONEncoder().encode(identityParts)) ?? Data()
            let fingerprint = SHA256.hash(data: identityData).map { String(format: "%02x", $0) }.joined()
            var dialogId = inheritedDialog
            let modal = ["AXGroup", "AXWindow", "AXSheet"].contains(role) && axBool(element, "AXModal" as CFString) == true
            let dialog = role == "AXSheet" || role == "AXDialog" || ["AXDialog", "AXApplicationDialog", "AXSystemDialog"].contains(subrole ?? "")
            if (dialog || modal), let bounds, obstructions.count < 8 {
                dialogId = obstructions.count
                obstructions.append(ObstructionResponse(id: dialogId!, role: role, subrole: subrole, name: sensitive ? "" : name, bounds: bounds, evidence: modal ? "modal" : "dialog"))
            }
            // Mask only explicit media roles, never ordinary images or groups
            // that might contain controls or the task's evidence.
            let media = ["AXVideo", "AXVideoPlayer"].contains(role)
            if role == "AXWebArea", let bounds {
                let area = bounds.width * bounds.height
                let currentArea = (contentBounds?.width ?? 0) * (contentBounds?.height ?? 0)
                if area > currentArea { contentBounds = bounds }
            }
            let ownsFocus = focusMayBeOwned && ownerTextRoles.contains(role)
                && ((axAttribute(element, "AXOwns" as CFString) as? [AXUIElement]) ?? []).prefix(8).contains { owned in focusAncestors.contains(where: { CFEqual($0, owned) }) }
            let focused = ownsFocus || (focusAncestors.first.map { CFEqual($0, element) } ?? (axBool(element, kAXFocusedAttribute as CFString) == true))
            let enabled = axBool(element, kAXEnabledAttribute as CFString)
            let focusable = axAttributeIsSettable(element, kAXFocusedAttribute as CFString)
            let valueSettable = axAttributeIsSettable(element, kAXValueAttribute as CFString)
            // Settable value is the generic editability signal. The role list
            // is retained only to distinguish text entry from adjustable
            // values such as sliders; it is not tied to application labels.
            let textRoles = Set(["AXTextField", "AXTextArea", "AXComboBox", "AXSearchField"])
            let editable = sensitive ? false : (textRoles.contains(role) ? valueSettable : false)
            let selected = axBool(element, kAXSelectedAttribute as CFString)
            let expanded = axBool(element, kAXExpandedAttribute as CFString)
            let orientation = axString(element, kAXOrientationAttribute as CFString).flatMap { raw -> String? in
                let lowered = raw.lowercased()
                if lowered.contains("horizontal") { return "horizontal" }
                if lowered.contains("vertical") { return "vertical" }
                return nil
            }
            let minValue = axNumber(element, kAXMinValueAttribute as CFString)
            let maxValue = axNumber(element, kAXMaxValueAttribute as CFString)
            let actions = axActions(element).prefix(12).map { bounded($0, 80) }
            // Focused and value settability were already read above; ask only for the other two.
            let settableAttributes: [String] = [
                ("AXFocused", focusable), ("AXValue", valueSettable),
                ("AXSelected", axAttributeIsSettable(element, kAXSelectedAttribute as CFString)),
                ("AXExpanded", axAttributeIsSettable(element, kAXExpandedAttribute as CFString)),
            ].compactMap { name, settable in settable == true ? name : nil }
            let checked: Bool? = ["AXCheckBox", "AXRadioButton", "AXSwitch"].contains(role)
                ? axNumber(element, kAXValueAttribute as CFString).map { $0 != 0 }
                : nil
            let actionable = !actions.isEmpty || !settableAttributes.isEmpty || focusable == true || editable == true
            let meaningful = !name.isEmpty || placeholder != nil || identifier != nil || rawValue != nil || sensitive || actionable || media || dialog || modal
            if meaningful && role != "unknown" {
                let response = ElementResponse(
                    role: role,
                    subrole: subrole,
                    name: sensitive ? "" : name,
                    description: sensitive ? nil : roleDescription,
                    help: sensitive ? nil : help,
                    placeholder: sensitive ? nil : placeholder,
                    identifier: sensitive ? nil : identifier,
                    value: rawValue,
                    bounds: bounds,
                    sensitive: sensitive,
                    focused: focused,
                    containsFocus: ownsFocus || focusAncestors.contains(where: { CFEqual($0, element) }) ? true : nil,
                    valueComplete: completeValue.map { $0.count <= textLimit },
                    enabled: enabled,
                    focusable: focusable,
                    editable: editable,
                    selected: selected,
                    expanded: expanded,
                    checked: checked,
                    orientation: orientation,
                    minValue: minValue,
                    maxValue: maxValue,
                    actions: actions,
                    settableAttributes: settableAttributes,
                    depth: depth,
                    fingerprint: fingerprint,
                    axPath: axPath,
                    axRoot: axRoot,
                    dialogId: dialogId,
                    media: media
                )
                // Text entry outranks everything: a page has hundreds of
                // links and one search field, and the field is what a task
                // needs. Bare groups and chrome fill the digest only after
                // the controls a person would name.
                let structural = ["AXGroup", "AXSplitter", "AXToolbar", "AXScrollArea", "AXUnknown"].contains(role)
                let label = (response.name + " " + (response.description ?? "") + " " + (sensitive ? "" : (response.value ?? ""))).lowercased()
                let matchedTerms = bounds == nil ? [] : preferTerms.indices.filter { preferTerms[$0] == priceTerm ? labelContainsCurrencyAmount(label) : labelContainsWordStarting(label, preferTerms[$0]) }
                // The goal-term bonus is added after the walk, weighted by how specific each term is on this page.
                let priority = (dialogId != nil && bounds != nil ? 20_000 : 0) + (editable == true ? 3_000 : 0) + (actionable ? 1_000 : 0) + (bounds != nil ? 200 : -10_000) + (focusAncestors.contains(where: { CFEqual($0, element) }) ? 100_000 : 0) - (structural ? 700 : 0) - depth
                candidates.append((response, priority, matchedTerms))
            }
            // A card, row or list item lying wholly outside the window holds
            // nothing on screen: its children lie inside it. Walking it spent
            // the node budget on content scrolled past. On a clothing retailer's product
            // grid, twelve screens down, the walk stopped
            // midway through the cards in view: names and ratings were read,
            // their prices never reached. Dialogs, alerts and the focus path
            // are always walked, so an overlay is never skipped this way.
            if bounds == nil, depth >= 6, offscreenPrunableRoles.contains(role),
               !(subrole ?? "").lowercased().contains("dialog"), !(subrole ?? "").lowercased().contains("alert"),
               !focusAncestors.contains(where: { CFEqual($0, element) }),
               axBool(element, "AXHidden" as CFString) != true,
               collapsed || (axGlobalBounds(element).map { !$0.intersects(window.frame) } ?? false) {
                return
            }
            guard let children = axAttribute(element, kAXChildrenAttribute as CFString) as? [AXUIElement] else { return }
            if children.count > 400 { truncation.insert("child") }
            // Traverse the selected window's focus path first, preserving original
            // sibling indices in identities. It must survive both time and count limits.
            let orderedChildren = children.enumerated().sorted { left, right in
                let leftFocused = focusAncestors.contains(where: { CFEqual($0, left.element) })
                let rightFocused = focusAncestors.contains(where: { CFEqual($0, right.element) })
                return leftFocused != rightFocused ? leftFocused : left.offset < right.offset
            }
            for (index, child) in orderedChildren.prefix(400) { walk(child, depth: depth + 1, parentPath: fingerprint, sibling: index, inheritedDialog: dialogId, axPath: axPath + [index], axRoot: axRoot) }
        }

        walk(root, depth: 0, parentPath: "window", sibling: 0, inheritedDialog: nil, axPath: [], axRoot: "window")
        if !deferred.isEmpty {
            walkingDeferred = true
            // Off-screen content ranks below everything on screen; it may use what is left of the walk, at most 0.3 s.
            activeDeadline = min(walkDeadline, Date().addingTimeInterval(0.3))
            for entry in deferred {
                guard visited.count < 2_500, Date() <= activeDeadline else { break }
                walk(entry.element, depth: entry.depth, parentPath: entry.parentPath, sibling: entry.sibling, inheritedDialog: entry.inheritedDialog, axPath: entry.axPath, axRoot: entry.axRoot)
            }
            walkingDeferred = false
        }
        // While Chrome's Find bar is open, the browser window's children list
        // only the bar: the page drops out of the tree even though it is on
        // screen and its elements still name this window as their ancestor
        // (a ticketing site: 1,203 nodes before Command-F, 7 after,
        // and every later turn was blind). A position query still reaches the
        // page, so recover its web area from there, but only one whose parent
        // chain ends in this exact window.
        let browser = (window.owningApplication?.bundleIdentifier ?? "").range(of: "chrome|chromium|brave|edge|firefox|safari|arc", options: [.regularExpression, .caseInsensitive]) != nil
        if browser, contentBounds == nil, visited.count < 2_500, Date() <= walkDeadline {
            let frame = window.frame
            for (xFraction, yFraction) in [(0.5, 0.55), (0.5, 0.8), (0.25, 0.5)] {
                var hit: AXUIElement?
                guard AXUIElementCopyElementAtPosition(application, Float(frame.minX + frame.width * xFraction), Float(frame.minY + frame.height * yFraction), &hit) == .success,
                      var cursor = hit else { continue }
                var webArea: AXUIElement?
                var reachesRoot = false
                for _ in 0..<60 {
                    if webArea == nil, axString(cursor, kAXRoleAttribute as CFString) == "AXWebArea" { webArea = cursor }
                    if CFEqual(cursor, root) { reachesRoot = true; break }
                    guard let parent = axAttribute(cursor, kAXParentAttribute as CFString), CFGetTypeID(parent) == AXUIElementGetTypeID() else { break }
                    cursor = (parent as! AXUIElement)
                }
                guard reachesRoot, let webArea, !visited.contains(CFHash(webArea)) else { continue }
                truncation.insert("web_area_recovered")
                walk(webArea, depth: 1, parentPath: "recovered-web-area", sibling: 0, inheritedDialog: nil, axPath: [], axRoot: "recovered-web-area")
                break
            }
        }
        // Report coverage as a hint; the execution-time hit test is authoritative.
        for index in candidates.indices {
            guard let bounds = candidates[index].element.bounds else { continue }
            let x = bounds.x + bounds.width / 2
            let y = bounds.y + bounds.height / 2
            candidates[index].element.obstructed = obstructions.contains { obstruction in
                candidates[index].element.dialogId != obstruction.id
                    && x >= obstruction.bounds.x && x <= obstruction.bounds.x + obstruction.bounds.width
                    && y >= obstruction.bounds.y && y <= obstruction.bounds.y + obstruction.bounds.height
            }
        }
        // A goal term that names a few controls identifies them; one that
        // matches hundreds identifies nothing. In testing, "stay" matched
        // every "Stay …" carousel card and, sharing the full bonus, pushed a
        // date picker's month arrows out of the budget. The full bonus goes to
        // terms matching at most `specificTermMatches` controls and shrinks in
        // proportion beyond that; each control takes its most specific term.
        var termMatches = Array(repeating: 0, count: preferTerms.count)
        for candidate in candidates { for term in candidate.matchedTerms { termMatches[term] += 1 } }
        for index in candidates.indices where !candidates[index].matchedTerms.isEmpty {
            let rarest = candidates[index].matchedTerms.map { termMatches[$0] }.min() ?? 1
            candidates[index].priority += preferredTermPriority * min(specificTermMatches, rarest) / max(rarest, 1)
        }
        let ranked = candidates.sorted { left, right in left.priority == right.priority ? left.element.depth < right.element.depth : left.priority > right.priority }
        let (output, encodedBytes, budgetReasons) = boundedElements(ranked.map(\.element), byteLimit: byteLimit)
        truncation.formUnion(budgetReasons)
        return WindowElementsResult(
            elements: output,
            status: output.isEmpty ? .walkEmpty : .available,
            matchDiagnostics: matchDiagnostics,
            contentBounds: contentBounds,
            completeness: ElementCompleteness(visited: visited.count, eligible: candidates.count, returned: output.count, encodedBytes: encodedBytes, reasons: truncation.sorted()),
            obstructions: obstructions
        )
    }

    /// The reserved price term matches a visible currency amount ("$79.50",
    /// "€ 12", "12.99 USD"), so a goal about cost keeps each product card's
    /// price beside its name (a clothing retailer's product grid).
    private static func labelContainsCurrencyAmount(_ label: String) -> Bool {
        let range = NSRange(label.startIndex..<label.endIndex, in: label)
        return currencyAmountPattern.firstMatch(in: label, options: [], range: range) != nil
    }

    /// A goal term matches where a word begins ("stay" in "Stays"), never in
    /// the middle of one: "can" must not lift every "free cancellation"
    /// carousel, nor "art" every "Start" button.
    private static func labelContainsWordStarting(_ label: String, _ term: String) -> Bool {
        var searchRange = label.startIndex..<label.endIndex
        while let found = label.range(of: term, range: searchRange) {
            if found.lowerBound == label.startIndex { return true }
            let previous = label[label.index(before: found.lowerBound)]
            if !previous.isLetter && !previous.isNumber { return true }
            searchRange = found.upperBound..<label.endIndex
        }
        return false
    }

    private static func boundedElements(_ elements: [ElementResponse], byteLimit: Int) -> ([ElementResponse], Int, Set<String>) {
        var truncation = Set<String>()
        var output: [ElementResponse] = []
        var encodedBytes = 2 // array delimiters
        let encoder = JSONEncoder()
        for element in elements {
            if output.count >= captureElementLimit { truncation.insert("count"); break }
            guard let data = try? encoder.encode(element) else { truncation.insert("validation"); continue }
            let additional = data.count + (output.isEmpty ? 0 : 1)
            guard encodedBytes + additional <= byteLimit else { truncation.insert("byte"); continue }
            output.append(element)
            encodedBytes += additional
        }
        return (output, encodedBytes, truncation)
    }

    private static func selectedWindowIsSoleNormalWindow(_ window: SCWindow) -> Bool {
        guard let processIdentifier = window.owningApplication?.processID,
              let descriptions = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else {
            return false
        }
        let normal = descriptions.compactMap { description -> (windowId: UInt32, bounds: CGRect)? in
            guard let owner = description[kCGWindowOwnerPID as String] as? NSNumber,
                  owner.int32Value == processIdentifier,
                  let layer = description[kCGWindowLayer as String] as? NSNumber,
                  layer.intValue == 0,
                  let number = description[kCGWindowNumber as String] as? NSNumber,
                  let boundsDictionary = description[kCGWindowBounds as String] as? NSDictionary,
                  let frame = CGRect(dictionaryRepresentation: boundsDictionary as CFDictionary),
                  frame.width >= 120, frame.height >= 80 else { return nil }
            return (number.uint32Value, frame)
        }
        guard normal.count == 1, let candidate = normal.first else { return false }
        return candidate.windowId == window.windowID
            && abs(candidate.bounds.origin.x - window.frame.origin.x) <= 2
            && abs(candidate.bounds.origin.y - window.frame.origin.y) <= 2
            && abs(candidate.bounds.width - window.frame.width) <= 2
            && abs(candidate.bounds.height - window.frame.height) <= 2
    }

    /**
     * Accessibility does not expose CGWindowIDs, so the selected window is
     * matched to an AX window by frame geometry. An ambiguous or missing match
     * returns nil rather than guessing at a sibling window's content.
     */
    private static func matchAXWindow(_ application: AXUIElement, window: SCWindow) -> (element: AXUIElement?, diagnostics: WindowMatchDiagnostics) {
        let processIdentifier = window.owningApplication?.processID
        // Some AppKit/SwiftUI utility applications expose their focused or
        // main AX window while omitting AXWindows altogether. Start with those
        // identity-bearing attributes, then add the ordinary window list.
        // This is still a candidate set only: every entry must pass the same
        // selected CGWindowID/bounds scoring below before its contents can be
        // observed.
        var raw: [AXUIElement] = []
        var seen = Set<CFHashCode>()
        func appendCandidate(_ candidate: AXUIElement) {
            let identity = CFHash(candidate)
            guard !seen.contains(identity) else { return }
            seen.insert(identity)
            raw.append(candidate)
        }
        for attribute in [kAXFocusedWindowAttribute, kAXMainWindowAttribute] {
            guard let value = axAttribute(application, attribute as CFString), CFGetTypeID(value) == AXUIElementGetTypeID() else { continue }
            appendCandidate(unsafeBitCast(value, to: AXUIElement.self))
        }
        for candidate in axAttribute(application, kAXWindowsAttribute as CFString) as? [AXUIElement] ?? [] {
            appendCandidate(candidate)
        }
        guard !raw.isEmpty else {
            return (nil, WindowMatchDiagnostics(owningProcessId: processIdentifier, candidateCount: 0, acceptedCandidateIndex: nil, uniqueBestMargin: nil, selectionEvidence: "none", candidates: []))
        }
        let targetFrame = window.frame
        let targetTitle = (window.title ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let scored = raw.enumerated().compactMap { index, candidate -> (Int, AXUIElement, WindowMatchCandidateDiagnostic)? in
            guard let candidateFrame = axGlobalBounds(candidate) else { return nil }
            let positionDelta = hypot(candidateFrame.origin.x - targetFrame.origin.x, candidateFrame.origin.y - targetFrame.origin.y)
            let sizeDelta = hypot(candidateFrame.width - targetFrame.width, candidateFrame.height - targetFrame.height)
            let intersection = candidateFrame.intersection(targetFrame)
            let unionArea = candidateFrame.width * candidateFrame.height + targetFrame.width * targetFrame.height - max(0, intersection.width) * max(0, intersection.height)
            let iou = unionArea > 0 ? max(0, intersection.width) * max(0, intersection.height) / unionArea : 0
            let candidateTitle = (axString(candidate, kAXTitleAttribute as CFString) ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            // Chromium exposes a stable AXWindowNumber for the real top-level
            // window even when it also publishes same-geometry AX aliases.
            // This is the only evidence strong enough to collapse those
            // aliases; an explicit different number may never fall back to
            // geometry or title similarity.
            // Only Chromium publishes that attribute. Every other application
            // (Chrome, Safari, AppKit) answers the Window Server id through
            // `_AXUIElementGetWindow`, the private call window managers rely
            // on; without it a Chrome window among same-geometry siblings can
            // never be told apart (18 candidates, margin 0.04).
            let candidateWindowId = axInt64(candidate, "AXWindowNumber" as CFString) ?? axWindowServerId(candidate)
            let windowIdMatch = candidateWindowId.map { $0 == Int64(window.windowID) }
            // Exact identity must outweigh a same-geometry Chromium sibling,
            // while a partial-title coincidence is supporting evidence only.
            // Previously both received 0.05, yet acceptance required a 0.06
            // margin; an exact title could therefore never disambiguate two
            // otherwise identical AX candidates.
            let titleRelation: String
            let titleScore: CGFloat
            // The window server elides long titles with an ellipsis; the AX
            // title is complete. An elided title whose head and tail both
            // match is the same title.
            let elidedParts = targetTitle.components(separatedBy: "\u{2026}")
            let elidedMatch = elidedParts.count == 2 && !candidateTitle.isEmpty
                && candidateTitle.hasPrefix(elidedParts[0].trimmingCharacters(in: .whitespaces))
                && candidateTitle.hasSuffix(elidedParts[1].trimmingCharacters(in: .whitespaces))
            if !targetTitle.isEmpty && targetTitle == candidateTitle {
                titleRelation = "exact"
                titleScore = 0.10
            } else if elidedMatch {
                titleRelation = "elided"
                titleScore = 0.09
            } else if !targetTitle.isEmpty && !candidateTitle.isEmpty && (targetTitle.contains(candidateTitle) || candidateTitle.contains(targetTitle)) {
                titleRelation = "contains"
                titleScore = 0.04
            } else {
                titleRelation = "none"
                titleScore = 0
            }
            let positionScore = max(0, 1 - positionDelta / 80)
            let sizeScore = max(0, 1 - sizeDelta / 80)
            let score = 0.50 * iou + 0.2 * positionScore + 0.2 * sizeScore + titleScore
            return (index, candidate, WindowMatchCandidateDiagnostic(
                index: index,
                iou: Double(iou),
                positionDelta: Double(positionDelta),
                sizeDelta: Double(sizeDelta),
                titleMatch: titleRelation != "none",
                titleRelation: titleRelation,
                windowIdMatch: windowIdMatch,
                score: Double(score)
            ))
        }.sorted { left, right in
            let leftIdentity = left.2.windowIdMatch == true ? 2 : left.2.windowIdMatch == nil ? 1 : 0
            let rightIdentity = right.2.windowIdMatch == true ? 2 : right.2.windowIdMatch == nil ? 1 : 0
            return leftIdentity == rightIdentity ? left.2.score > right.2.score : leftIdentity > rightIdentity
        }
        let diagnostics = scored.prefix(6).map { $0.2 }
        let explicitMatches = scored.filter { $0.2.windowIdMatch == true }
        // A candidate that reports a different Window Server id is excluded
        // from the fallback set. Nil means the application did not expose the
        // attribute, so the conservative geometry/title policy still applies.
        let ranked = explicitMatches.isEmpty ? scored.filter { $0.2.windowIdMatch == nil } : explicitMatches
        let best = ranked.first
        let margin = ranked.count > 1 ? (best!.2.score - ranked[1].2.score) : best?.2.score
        let selectedByWindowId = !explicitMatches.isEmpty
        // A candidate whose frame is the target frame to the point is that
        // window, however close a neighbouring window's score comes — a second
        // window of the same app offset by a few points is a different window.
        // Only two candidates with the same exact geometry are truly ambiguous.
        let exactGeometry: (WindowMatchCandidateDiagnostic) -> Bool = { $0.iou >= 0.985 && $0.positionDelta <= 2 && $0.sizeDelta <= 2 }
        let exactCandidates = ranked.filter { exactGeometry($0.2) }
        let uniquelyExact = exactCandidates.count == 1 && best != nil && exactGeometry(best!.2)
        let accepted = best != nil
            && best!.2.iou >= 0.72
            && best!.2.score >= 0.78
            && (selectedByWindowId || uniquelyExact || ranked.count == 1 || (margin ?? 0) >= 0.06)
        return (
            accepted ? best?.1 : nil,
            WindowMatchDiagnostics(
                owningProcessId: processIdentifier,
                candidateCount: scored.count,
                acceptedCandidateIndex: accepted ? best?.0 : nil,
                uniqueBestMargin: margin,
                selectionEvidence: accepted ? (selectedByWindowId ? "window_id" : uniquelyExact ? "exact_geometry" : "scored_unique") : "none",
                candidates: diagnostics
            )
        )
    }

    private static func windowRelativeBounds(_ element: AXUIElement, window: CGRect) -> Bounds? {
        guard let global = axGlobalBounds(element) else { return nil }
        let relative = CGRect(
            x: global.origin.x - window.origin.x,
            y: global.origin.y - window.origin.y,
            width: global.width,
            height: global.height
        )
        guard relative.maxX > 0, relative.maxY > 0, relative.minX < window.width, relative.minY < window.height else { return nil }
        return bounds(relative)
    }

    private static func axGlobalBounds(_ element: AXUIElement) -> CGRect? {
        guard let rawPosition = axAttribute(element, kAXPositionAttribute as CFString), CFGetTypeID(rawPosition) == AXValueGetTypeID(),
              let rawSize = axAttribute(element, kAXSizeAttribute as CFString), CFGetTypeID(rawSize) == AXValueGetTypeID() else { return nil }
        let positionValue = unsafeBitCast(rawPosition, to: AXValue.self)
        let sizeValue = unsafeBitCast(rawSize, to: AXValue.self)
        var point = CGPoint.zero
        var size = CGSize.zero
        guard AXValueGetValue(positionValue, .cgPoint, &point), AXValueGetValue(sizeValue, .cgSize, &size), size.width > 0, size.height > 0 else { return nil }
        return CGRect(origin: point, size: size)
    }

    private static func axAttribute(_ element: AXUIElement, _ attribute: CFString) -> CFTypeRef? {
        if let cached = prefetched, CFEqual(cached.element, element), let entry = cached.values[attribute as String] { return entry }
        var value: CFTypeRef?
        return AXUIElementCopyAttributeValue(element, attribute, &value) == .success ? value : nil
    }

    /** One element's attributes, read in a single accessibility round trip.
     * Each separate read is an IPC call into the target application; the walk
     * made about 25 per element, and on a long web page the accessibility
     * phase was 433 ms of a 684 ms capture (bench). Attributes the
     * element does not support come back as errors and stay nil, exactly as a
     * single read would; if the batched call fails, reads fall back to one at
     * a time. */
    nonisolated(unsafe) private static var prefetched: (element: AXUIElement, values: [String: CFTypeRef?])? = nil
    private static let prefetchedAttributeNames: [String] = [
        kAXRoleAttribute as String, "AXHidden", kAXPositionAttribute as String, kAXSizeAttribute as String, kAXSubroleAttribute as String,
        kAXTitleAttribute as String, kAXDescriptionAttribute as String, kAXRoleDescriptionAttribute as String, kAXHelpAttribute as String,
        kAXPlaceholderValueAttribute as String, kAXIdentifierAttribute as String, kAXValueAttribute as String, "AXValueDescription",
        kAXFocusedAttribute as String, kAXEnabledAttribute as String, kAXSelectedAttribute as String, kAXExpandedAttribute as String,
        kAXOrientationAttribute as String, kAXMinValueAttribute as String, kAXMaxValueAttribute as String, "AXModal", kAXChildrenAttribute as String,
        "AXNumberOfCharacters",
    ]
    private static func prefetchAttributes(_ element: AXUIElement) {
        prefetched = nil
        guard ProcessInfo.processInfo.environment["STEWARD_AX_PREFETCH"] != "off" else { return }
        var raw: CFArray?
        guard AXUIElementCopyMultipleAttributeValues(element, prefetchedAttributeNames as CFArray, AXCopyMultipleAttributeOptions(rawValue: 0), &raw) == .success,
              let values = raw as? [AnyObject], values.count == prefetchedAttributeNames.count else { return }
        var map: [String: CFTypeRef?] = [:]
        for (index, name) in prefetchedAttributeNames.enumerated() {
            let value = values[index] as CFTypeRef
            if CFGetTypeID(value) == AXValueGetTypeID(), AXValueGetType(value as! AXValue) == .axError { map[name] = .some(nil) } else { map[name] = .some(value) }
        }
        prefetched = (element, map)
    }

    private static func axBool(_ element: AXUIElement, _ attribute: CFString) -> Bool? {
        guard let value = axAttribute(element, attribute), CFGetTypeID(value) == CFBooleanGetTypeID() else { return nil }
        return CFBooleanGetValue(unsafeBitCast(value, to: CFBoolean.self))
    }

    private static func axNumber(_ element: AXUIElement, _ attribute: CFString) -> Double? {
        guard let value = axAttribute(element, attribute), let number = value as? NSNumber else { return nil }
        let result = number.doubleValue
        return result.isFinite ? result : nil
    }

    /// The Window Server id of an AX window from `_AXUIElementGetWindow`:
    /// private, but stable since 10.x and what every window manager uses.
    /// Nil when the call fails or answers zero, so the caller falls back to
    /// the geometry and title policy exactly as before.
    private static func axWindowServerId(_ element: AXUIElement) -> Int64? {
        var identifier: CGWindowID = 0
        guard carvePrivateAXUIElementGetWindow(element, &identifier) == .success, identifier != 0 else { return nil }
        return Int64(identifier)
    }

    private static func axInt64(_ element: AXUIElement, _ attribute: CFString) -> Int64? {
        guard let value = axAttribute(element, attribute), CFGetTypeID(value) == CFNumberGetTypeID(),
              let number = value as? NSNumber else { return nil }
        return number.int64Value
    }

    private static func axActions(_ element: AXUIElement) -> [String] {
        var names: CFArray?
        guard AXUIElementCopyActionNames(element, &names) == .success, let values = names as? [String] else { return [] }
        return values
    }

    private static func axAttributeIsSettable(_ element: AXUIElement, _ attribute: CFString) -> Bool? {
        var settable = DarwinBoolean(false)
        let result = AXUIElementIsAttributeSettable(element, attribute, &settable)
        return result == .success ? settable.boolValue : nil
    }

    /**
     * An attribute that exists but carries no text is absent, not present.
     * This is what makes the `AXTitle ?? AXDescription` fallback work at all:
     * Chromium publishes an EMPTY AXTitle on every toolbar button, tab, and
     * address field and puts the real label in AXDescription. Returning that
     * empty string as a value short-circuited the fallback, so until
     * that was fixed every Chrome control reached the digest anonymous — and an
     * anonymous control cannot be named as a targetElementId, so the planner
     * correctly fell back to pixel grounding on all 174 pointer actions ever
     * proposed. Empty values are dropped for the same reason: they add
     * nameless rows that crowd out real controls inside the element budget.
     */
    private static func axString(_ element: AXUIElement, _ attribute: CFString) -> String? {
        guard let value = axAttribute(element, attribute) else { return nil }
        if let string = value as? String { return string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : string }
        // Native document editors commonly expose their editable body as an
        // attributed string rather than a CFString. Treat the characters as
        // value evidence while discarding all formatting metadata. This keeps
        // exact-text reconciliation local and works for any AX text control
        // that follows the platform contract, not just TextEdit.
        if let attributed = value as? NSAttributedString {
            let string = attributed.string
            return string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : string
        }
        if let number = value as? NSNumber { return number.stringValue }
        return nil
    }

    /** Empty and whitespace-only text are real values. Unlike labels, text
     * values must not be trimmed or dropped during effect reconciliation. */
    private static let adjustableRoles: Set<String> = ["AXIncrementor", "AXStepper", "AXSlider", "AXDateField", "AXTimeField"]

    /** Value evidence for adjustable controls only: a numeric AXValue, or the
     * value description a segmented field publishes instead of AXValue. */
    private static func adjustableValue(_ element: AXUIElement, role: String) -> String? {
        guard adjustableRoles.contains(role) else { return nil }
        // A segment's own description is its displayed value ("PM", "02");
        // an empty segment reports no characters and a numeric AXValue of 0,
        // which must read as empty, not as a value.
        if let described = axString(element, "AXValueDescription" as CFString) { return described }
        if axNumber(element, "AXNumberOfCharacters" as CFString) == 0 { return nil }
        if let raw = axAttribute(element, kAXValueAttribute as CFString), let number = raw as? NSNumber, CFGetTypeID(raw) == CFNumberGetTypeID() {
            let value = number.doubleValue
            guard value.isFinite else { return nil }
            return value.rounded() == value && abs(value) < 1e15 ? String(Int64(value)) : number.stringValue
        }
        return nil
    }

    private static func axTextValue(_ element: AXUIElement) -> String? {
        guard let value = axAttribute(element, kAXValueAttribute as CFString) else { return nil }
        if let string = value as? String { return string }
        if let attributed = value as? NSAttributedString { return attributed.string }
        return nil
    }

    private static func execute(_ command: Command) async throws -> ActionResponse {
        try requireScreenRecording()
        guard AXIsProcessTrusted() else { throw ComputerError.permissionDenied("Grant Accessibility to the Carve live computer helper before controlling a window") }
        guard let target = command.target, let input = command.input else { throw ComputerError.invalidRequest("A selected window and bounded input are required") }
        guard let application = NSRunningApplication.runningApplications(withBundleIdentifier: target.bundleIdentifier).first else { throw ComputerError.targetUnavailable }
        _ = application.activate(options: [.activateIgnoringOtherApps])
        try await Task.sleep(nanoseconds: 250_000_000)
        guard NSWorkspace.shared.frontmostApplication?.bundleIdentifier == target.bundleIdentifier else { throw ComputerError.focusChanged }
        let window = try await resolve(target)
        switch input.kind {
        case "move":
            try move(try globalPoint(input.point, in: window))
        case "click":
            try click(try globalPoint(input.point, in: window))
        case "scroll":
            guard let scrollY = input.scrollY, scrollY.isFinite, abs(scrollY) >= 1, abs(scrollY) <= 2_000 else { throw ComputerError.invalidRequest("Scroll amount is outside the safe range") }
            try scroll(scrollY, in: window)
        case "type":
            guard let text = input.text, !text.isEmpty, text.count <= 1_000 else { throw ComputerError.invalidRequest("Typing requires at most 1,000 characters") }
            try type(text, delivery: input.textDelivery ?? "keycodes")
        case "keypress":
            guard let key = input.key else { throw ComputerError.invalidRequest("Keypress requires a key") }
            try keypress(key)
        default: throw ComputerError.invalidRequest("Input action is not allowed")
        }
        return ActionResponse(executed: input.kind)
    }

    // Window identity and bounds validation stay in the ScreenCaptureKit
    // helper. Focus and the actual CGEvent calls run atomically inside
    // Electron's main process, because that is the process the user authorizes
    // as "Carve" in macOS Accessibility settings. Do not try to focus here:
    // NSRunningApplication activation is asynchronous (and its historical
    // ignore-other-apps option is deprecated), so a fixed-delay frontmost check
    // can reject a valid target before the input bridge gets a chance to raise
    // and verify the exact AX window. The bridge still fails closed before any
    // input if the identity, bounds, frontmost app, focused window, or main
    // window cannot be proven.
    private static func prepareInput(_ command: Command) async throws -> PreparedInputResponse {
        try requireScreenRecording()
        guard let target = command.target else { throw ComputerError.invalidRequest("A selected window is required") }
        guard NSRunningApplication.runningApplications(withBundleIdentifier: target.bundleIdentifier).first != nil else { throw ComputerError.targetUnavailable }
        let window = try await resolve(target)
        return PreparedInputResponse(bounds: bounds(window.frame))
    }

    private static func requireScreenRecording() throws {
        guard CGPreflightScreenCaptureAccess() else { throw ComputerError.permissionDenied("Grant Screen Recording to the Carve live computer helper") }
    }

    private static func resolve(_ target: Target) async throws -> SCWindow {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let window = content.windows.first(where: {
            $0.windowID == target.windowId && $0.owningApplication?.bundleIdentifier == target.bundleIdentifier
        }) else { throw ComputerError.targetUnavailable }
        return window
    }

    private static func globalPoint(_ point: Point?, in window: SCWindow) throws -> CGPoint {
        guard let point,
              point.x.isFinite, point.y.isFinite,
              point.x >= 0, point.y >= 0,
              point.x <= window.frame.width, point.y <= window.frame.height else {
            throw ComputerError.invalidRequest("Pointer target lies outside the selected window")
        }
        return CGPoint(x: window.frame.origin.x + point.x, y: window.frame.origin.y + point.y)
    }

    private static func move(_ point: CGPoint) throws {
        guard let event = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left) else { throw ComputerError.invalidRequest("Could not create pointer event") }
        event.post(tap: .cghidEventTap)
    }

    private static func click(_ point: CGPoint) throws {
        try move(point)
        guard let down = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left),
              let up = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left) else {
            throw ComputerError.invalidRequest("Could not create click event")
        }
        down.post(tap: .cghidEventTap)
        up.post(tap: .cghidEventTap)
    }

    private static func scroll(_ amount: Double, in window: SCWindow) throws {
        let location = CGPoint(x: window.frame.midX, y: window.frame.midY)
        try move(location)
        Thread.sleep(forTimeInterval: 0.08)
        let pulses = min(5, max(1, Int(ceil(abs(amount) / 240.0))))
        let wheel: Int32 = amount > 0 ? -6 : 6
        for _ in 0..<pulses {
            guard let event = CGEvent(scrollWheelEvent2Source: nil, units: .line, wheelCount: 1, wheel1: wheel, wheel2: 0, wheel3: 0) else {
                throw ComputerError.invalidRequest("Could not create scroll event")
            }
            event.location = location
            event.post(tap: .cghidEventTap)
            Thread.sleep(forTimeInterval: 0.03)
        }
    }

    private static func type(_ text: String, delivery: String) throws {
        if delivery == "keycodes" {
            let strokes = try text.map { character -> (CGKeyCode, CGEventFlags) in
                guard let stroke = textStroke(character) else { throw ComputerError.invalidRequest("Keycode delivery does not support this text") }
                return stroke
            }
            for (code, flags) in strokes {
                try postKey(code, flags: flags)
                Thread.sleep(forTimeInterval: 0.008)
            }
            return
        }
        guard delivery == "unicode_graphemes" else { throw ComputerError.invalidRequest("Unknown text-delivery method") }
        for grapheme in text {
            guard let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true),
                  let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false) else {
                throw ComputerError.invalidRequest("Could not create typing event")
            }
            let characters = Array(String(grapheme).utf16)
            characters.withUnsafeBufferPointer { buffer in
                down.keyboardSetUnicodeString(stringLength: characters.count, unicodeString: buffer.baseAddress)
                up.keyboardSetUnicodeString(stringLength: characters.count, unicodeString: buffer.baseAddress)
            }
            down.post(tap: .cghidEventTap)
            up.post(tap: .cghidEventTap)
            Thread.sleep(forTimeInterval: 0.008)
        }
    }

    private static func textStroke(_ character: Character) -> (CGKeyCode, CGEventFlags)? {
        guard let ascii = character.asciiValue else { return nil }
        var normalized = ascii
        var flags: CGEventFlags = []
        if ascii >= 65 && ascii <= 90 {
            normalized = ascii + 32
            flags = [.maskShift]
        }
        let plain: [UInt8: CGKeyCode] = [
            97: 0, 115: 1, 100: 2, 102: 3, 104: 4, 103: 5, 122: 6, 120: 7, 99: 8, 118: 9,
            98: 11, 113: 12, 119: 13, 101: 14, 114: 15, 121: 16, 116: 17, 49: 18, 50: 19,
            51: 20, 52: 21, 54: 22, 53: 23, 61: 24, 57: 25, 55: 26, 45: 27, 56: 28, 48: 29,
            93: 30, 111: 31, 117: 32, 91: 33, 105: 34, 112: 35, 108: 37, 106: 38, 39: 39,
            107: 40, 59: 41, 92: 42, 44: 43, 47: 44, 110: 45, 109: 46, 46: 47, 32: 49, 96: 50,
        ]
        if let code = plain[normalized] { return (code, flags) }
        let shifted: [UInt8: CGKeyCode] = [
            95: 27, 43: 24, 40: 25, 41: 29, 33: 18, 64: 19, 35: 20, 36: 21, 37: 23,
            94: 22, 38: 26, 42: 28, 58: 41, 34: 39, 60: 43, 62: 47, 63: 44, 123: 33,
            125: 30, 124: 42, 126: 50,
        ]
        guard let code = shifted[ascii] else { return nil }
        return (code, [.maskShift])
    }

    private static func postKey(_ code: CGKeyCode, flags: CGEventFlags) throws {
        guard let down = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: true),
              let up = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: false) else {
            throw ComputerError.invalidRequest("Could not create key event")
        }
        down.flags = flags
        up.flags = flags
        down.post(tap: .cghidEventTap)
        up.post(tap: .cghidEventTap)
    }

    /** ⌘N for the application Carve just activated for a fresh window. */
    private static func postNewDocumentShortcut() throws {
        guard let code = keyCode("N") else { throw ComputerError.invalidRequest("Unsupported keypress") }
        try postKey(code, flags: [.maskCommand])
    }

    private static func keypress(_ raw: String) throws {
        let normalized = raw.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        let safeKeys = ["TAB", "SHIFT+TAB", "SELECT_ALL", "CMD+T", "CTRL+TAB", "CTRL+SHIFT+TAB", "RETURN", "ENTER", "ESC", "ESCAPE", "SPACE", "UP", "DOWN", "LEFT", "RIGHT"]
        guard safeKeys.contains(normalized) else { throw ComputerError.invalidRequest("Keypress is limited to safe navigation keys") }
        let flags: CGEventFlags = normalized == "SHIFT+TAB" ? [.maskShift]
            : normalized == "SELECT_ALL" || normalized == "CMD+T" ? [.maskCommand]
            : normalized == "CTRL+TAB" ? [.maskControl]
            : normalized == "CTRL+SHIFT+TAB" ? [.maskControl, .maskShift]
            : []
        let keyName = ["SHIFT+TAB", "CTRL+TAB", "CTRL+SHIFT+TAB"].contains(normalized) ? "TAB"
            : normalized == "SELECT_ALL" ? "A"
            : normalized == "CMD+T" ? "T"
            : normalized
        guard let code = keyCode(keyName) else { throw ComputerError.invalidRequest("Unsupported keypress") }
        guard let down = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: true),
              let up = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: false) else { throw ComputerError.invalidRequest("Could not create key event") }
        down.flags = flags
        up.flags = flags
        down.post(tap: .cghidEventTap)
        up.post(tap: .cghidEventTap)
    }

    private static func keyCode(_ name: String) -> CGKeyCode? {
        let special: [String: CGKeyCode] = [
            "RETURN": 36, "ENTER": 36, "TAB": 48, "ESC": 53, "ESCAPE": 53, "SPACE": 49,
            "DELETE": 51, "BACKSPACE": 51, "UP": 126, "DOWN": 125, "LEFT": 123, "RIGHT": 124,
        ]
        if let special = special[name] { return special }
        let letters: [String: CGKeyCode] = [
            "A": 0, "B": 11, "C": 8, "D": 2, "E": 14, "F": 3, "G": 5, "H": 4, "I": 34,
            "J": 38, "K": 40, "L": 37, "M": 46, "N": 45, "O": 31, "P": 35, "Q": 12, "R": 15,
            "S": 1, "T": 17, "U": 32, "V": 9, "W": 13, "X": 7, "Y": 16, "Z": 6,
        ]
        return letters[name]
    }

    private static func pngData(_ image: CGImage) throws -> Data {
        let output = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(output, UTType.png.identifier as CFString, 1, nil) else { throw ComputerError.invalidRequest("Could not encode screenshot") }
        CGImageDestinationAddImage(destination, image, nil)
        guard CGImageDestinationFinalize(destination) else { throw ComputerError.invalidRequest("Could not finalize screenshot") }
        return output as Data
    }

    /**
     * A tiny grayscale sample lets the control plane check that an approved
     * visible action actually changed the selected window. It is deliberately
     * coarse, stays in memory, and is never persisted as learning evidence.
     */
    // Ephemeral sRGB pixels for drawing contrast; never written to a frame file.
    private static func colorSample(_ image: CGImage) throws -> Data {
        let width = 192, height = 128
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        guard let space = CGColorSpace(name: CGColorSpace.sRGB), let context = CGContext(
            data: &pixels, width: width, height: height, bitsPerComponent: 8,
            bytesPerRow: width * 4, space: space,
            bitmapInfo: CGBitmapInfo.byteOrder32Big.rawValue | CGImageAlphaInfo.premultipliedLast.rawValue
        ) else { throw ComputerError.invalidRequest("Could not sample drawing colors") }
        context.interpolationQuality = .medium
        context.setFillColor(CGColor(gray: 1, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        return Data(pixels)
    }

    private static func visualSample(_ image: CGImage, width: Int, height: Int) throws -> String {
        var pixels = [UInt8](repeating: 0, count: width * height)
        guard let context = CGContext(
            data: &pixels,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: width,
            space: CGColorSpaceCreateDeviceGray(),
            bitmapInfo: CGImageAlphaInfo.none.rawValue
        ) else { throw ComputerError.invalidRequest("Could not sample the live frame") }
        context.interpolationQuality = .medium
        context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        return Data(pixels).base64EncodedString()
    }

    private static func bounds(_ rect: CGRect) -> Bounds {
        Bounds(x: rect.origin.x, y: rect.origin.y, width: rect.width, height: rect.height)
    }

    private static func bounded(_ value: String, _ maximum: Int) -> String {
        String(value.prefix(maximum))
    }

    private static func write<T: Encodable>(_ value: T) {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        do {
            let data = try encoder.encode(value)
            guard data.count <= 4_000_000 else { throw ComputerError.outputLimit }
            FileHandle.standardOutput.write(data)
        } catch {
            FileHandle.standardOutput.write(Data("{\"ok\":false,\"errorCode\":\"output_limit\",\"error\":\"Helper response could not fit its encoding budget\"}".utf8))
        }
    }
}
