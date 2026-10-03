import Foundation
import LocalAuthentication

private let helperVersion = "0.1.0"

private struct Command: Decodable {
    let action: String
    let reason: String?
}

private struct StatusResponse: Encodable {
    let ok = true
    let helperVersion: String
    let available: Bool
    let mechanism = "device_owner_authentication"
    let error: String?
}

private struct AuthenticationResponse: Encodable {
    let ok = true
    let authenticated = true
    let mechanism = "device_owner_authentication"
}

private struct ErrorResponse: Encodable {
    let ok = false
    let error: String
}

@main
private enum CarveAuthenticationHelper {
    static func main() async {
        do {
            let input = FileHandle.standardInput.readDataToEndOfFile()
            guard input.count <= 4_096 else { throw AuthenticationError.invalidRequest("Request exceeds 4 KB") }
            let command = try JSONDecoder().decode(Command.self, from: input)
            switch command.action {
            case "status":
                let context = LAContext()
                var error: NSError?
                let available = context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error)
                write(StatusResponse(
                    helperVersion: helperVersion,
                    available: available,
                    error: available ? nil : error?.localizedDescription
                ))
            case "authenticate":
                let reason = command.reason?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                guard !reason.isEmpty && reason.count <= 160 else {
                    throw AuthenticationError.invalidRequest("A short authentication reason is required")
                }
                let context = LAContext()
                context.localizedCancelTitle = "Cancel"
                var availabilityError: NSError?
                guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &availabilityError) else {
                    throw AuthenticationError.unavailable(availabilityError?.localizedDescription ?? "Device-owner authentication is unavailable")
                }
                let authenticated = try await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason)
                guard authenticated else { throw AuthenticationError.denied }
                write(AuthenticationResponse())
            default:
                throw AuthenticationError.invalidRequest("Unknown action")
            }
        } catch {
            write(ErrorResponse(error: message(for: error)))
            Foundation.exit(1)
        }
    }

    private static func message(for error: Error) -> String {
        if let authenticationError = error as? AuthenticationError { return authenticationError.description }
        if let localError = error as? LAError {
            switch localError.code {
            case .userCancel, .appCancel, .systemCancel: return "Authentication was cancelled"
            case .authenticationFailed: return "Authentication failed"
            case .biometryLockout: return "Authentication is temporarily locked"
            default: return localError.localizedDescription
            }
        }
        return "Authentication failed"
    }

    private static func write<T: Encodable>(_ response: T) {
        guard let data = try? JSONEncoder().encode(response) else { return }
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([0x0A]))
    }
}

private enum AuthenticationError: Error, CustomStringConvertible {
    case invalidRequest(String)
    case unavailable(String)
    case denied

    var description: String {
        switch self {
        case .invalidRequest(let message): return "Invalid request: \(message)"
        case .unavailable(let message): return message
        case .denied: return "Authentication failed"
        }
    }
}
