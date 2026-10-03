import Foundation
import Security

private struct Command: Decodable {
    let action: String
    let account: String
    let value: String?
}

private struct Reply: Encodable {
    let ok: Bool
    var value: String? = nil
    var code: String? = nil
}

@main
private enum CarveKeychainHelper {
    static func main() {
        // Never hang a background cloud request behind a Keychain permission
        // dialog. Locked/denied access is an explicit, recoverable failure.
        SecKeychainSetUserInteractionAllowed(false)
        do {
            guard let service = authorizedService() else {
                return reply(Reply(ok: false, code: "caller_denied"))
            }
            let input = FileHandle.standardInput.readData(ofLength: 16_385)
            guard input.count <= 16_384 else { return reply(Reply(ok: false, code: "invalid_request")) }
            let command = try JSONDecoder().decode(Command.self, from: input)
            guard command.account.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else {
                return reply(Reply(ok: false, code: "invalid_request"))
            }
            let query: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: service,
                kSecAttrAccount as String: command.account,
            ]
            switch command.action {
            case "read":
                var read = query
                read[kSecReturnData as String] = true
                read[kSecMatchLimit as String] = kSecMatchLimitOne
                var result: CFTypeRef?
                let status = SecItemCopyMatching(read as CFDictionary, &result)
                if status == errSecItemNotFound { return reply(Reply(ok: true)) }
                guard status == errSecSuccess else { return failure(status) }
                guard let data = result as? Data, let value = String(data: data, encoding: .utf8) else {
                    return reply(Reply(ok: false, code: "corrupt"))
                }
                reply(Reply(ok: true, value: value))
            case "write":
                guard let value = command.value, let data = value.data(using: .utf8), data.count <= 8_192 else {
                    return reply(Reply(ok: false, code: "invalid_request"))
                }
                let attributes = [kSecValueData as String: data]
                var status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
                if status == errSecItemNotFound {
                    var add = query
                    add[kSecValueData as String] = data
                    add[kSecAttrLabel as String] = "Carve Cloud account"
                    // The default file-based login Keychain is local to this Mac.
                    // No synchronizable/access-group entitlement is requested.
                    status = SecItemAdd(add as CFDictionary, nil)
                    if status == errSecDuplicateItem {
                        status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
                    }
                }
                if status == errSecSuccess { reply(Reply(ok: true)) } else { failure(status) }
            case "delete":
                let status = SecItemDelete(query as CFDictionary)
                if status == errSecSuccess || status == errSecItemNotFound { reply(Reply(ok: true)) } else { failure(status) }
            default: reply(Reply(ok: false, code: "invalid_request"))
            }
        } catch {
            reply(Reply(ok: false, code: "invalid_request"))
        }
    }

    /// A distribution helper may only release tokens to the signed Carve main
    /// process from the same team. Otherwise any local app could invoke this
    /// trusted helper to bypass the Keychain item's own access control.
    private static func authorizedService() -> String? {
        var ownCode: SecCode?
        guard SecCodeCopySelf([], &ownCode) == errSecSuccess, let ownCode else { return nil }
        var staticCode: SecStaticCode?
        guard SecCodeCopyStaticCode(ownCode, [], &staticCode) == errSecSuccess, let staticCode else { return nil }
        var information: CFDictionary?
        guard SecCodeCopySigningInformation(staticCode, SecCSFlags(rawValue: kSecCSSigningInformation), &information) == errSecSuccess else { return nil }
        let values = information as? [String: Any]
        guard let team = values?[kSecCodeInfoTeamIdentifier as String] as? String else {
            // Ad-hoc development never shares the release service namespace.
            return "app.carve.desktop.cloud.development.v1"
        }
        guard team.range(of: "^[A-Z0-9]{10}$", options: .regularExpression) != nil else { return nil }
        var parent: SecCode?
        guard SecCodeCopyGuestWithAttributes(nil, [kSecGuestAttributePid as String: getppid()] as CFDictionary, [], &parent) == errSecSuccess, let parent else { return nil }
        var requirement: SecRequirement?
        let text = "anchor apple generic and identifier \"app.carve.desktop\" and certificate leaf[subject.OU] = \"\(team)\""
        guard SecRequirementCreateWithString(text as CFString, [], &requirement) == errSecSuccess, let requirement else { return nil }
        guard SecCodeCheckValidity(parent, [], requirement) == errSecSuccess else { return nil }
        return "app.carve.desktop.cloud.v1"
    }

    private static func failure(_ status: OSStatus) {
        let code: String
        switch status {
        case errSecInteractionNotAllowed: code = "locked"
        case errSecAuthFailed, errSecUserCanceled: code = "denied"
        default: code = "unavailable"
        }
        reply(Reply(ok: false, code: code))
    }

    private static func reply(_ value: Reply) {
        guard let data = try? JSONEncoder().encode(value) else { exit(1) }
        FileHandle.standardOutput.write(data)
        exit(value.ok ? 0 : 1)
    }
}
