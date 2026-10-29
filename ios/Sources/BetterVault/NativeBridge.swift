import Foundation
import LocalAuthentication
import UIKit
import WebKit

/**
 * Pont entre la page et iOS, sous le nom que la page attend de Tauri
 * (window.__TAURI_INTERNALS__.invoke) : src/platform/tauriBridge.ts,
 * biometric.ts et storage.ts n'ont rien à savoir de xtool.
 *
 * Chaque commande reprend celle de src-tauri/src/lib.rs, mêmes noms, mêmes
 * arguments, mêmes erreurs. Une commande absente (Argon2id natif) échoue :
 * la page retombe alors sur son implémentation JavaScript.
 */
final class NativeBridge: NSObject, WKScriptMessageHandlerWithReply {
    static let handlerName = "bettervault"

    /*
     * Injecté avant tout script de la page. Les erreurs sont rejetées en texte,
     * comme Tauri, et non en objet Error : la page compare leur message.
     */
    static let injectedScript = """
    (() => {
      const handler = window.webkit.messageHandlers.\(handlerName);
      const invoke = async (cmd, args = {}) => {
        const reply = await handler.postMessage({ cmd, args: args ?? {} });
        if (!reply || reply.ok !== true) throw (reply && reply.error) || 'Erreur native';
        return reply.value;
      };
      Object.defineProperty(window, '__TAURI_INTERNALS__', {
        value: Object.freeze({ invoke, metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } } }),
        configurable: false,
        writable: false
      });
    })();
    """

    /// Espace du trousseau lisible seulement après Face ID, dans le même appel (voir lib.rs)
    private static let protectedPrefix = "bio."

    private struct BridgeError: Error {
        let message: String
        init(_ message: String) { self.message = message }
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping (Any?, String?) -> Void
    ) {
        let reply: (Result<Any, BridgeError>) -> Void = { result in
            DispatchQueue.main.async {
                switch result {
                case .success(let value): replyHandler(["ok": true, "value": value], nil)
                case .failure(let error): replyHandler(["ok": false, "error": error.message], nil)
                }
            }
        }

        // Seule la page de l'application parle au pont : ni un cadre, ni une page chargée d'ailleurs
        guard message.frameInfo.isMainFrame,
              message.frameInfo.securityOrigin.protocol == WebAppSchemeHandler.scheme,
              let body = message.body as? [String: Any],
              let command = body["cmd"] as? String else {
            reply(.failure(BridgeError("Appel natif refusé")))
            return
        }
        let args = body["args"] as? [String: Any] ?? [:]
        handle(command, args, reply)
    }

    /// Résultat d'une commande ; une valeur absente devient null pour la page
    private func attempt(_ body: () throws -> Any?) -> Result<Any, BridgeError> {
        do {
            return .success(try body() ?? NSNull())
        } catch let error as Keychain.Failure {
            return .failure(BridgeError(error.message))
        } catch {
            return .failure(BridgeError(error.localizedDescription))
        }
    }

    private func handle(_ command: String, _ args: [String: Any], _ reply: @escaping (Result<Any, BridgeError>) -> Void) {
        func text(_ key: String) -> String? { args[key] as? String }

        switch command {
        // ── Stockage du compte et du coffre chiffré ──────────────────────
        case "storage_read_all":
            reply(attempt { try AppStorage.readAll() })
        case "storage_write_all":
            guard let entries = args["entries"] as? [String: String] else { return reply(.failure(BridgeError("Entrées invalides"))) }
            reply(attempt { try AppStorage.writeAll(entries); return NSNull() })

        // ── Trousseau ────────────────────────────────────────────────────
        case "get_os_keychain_available":
            reply(.success(Keychain.isAvailable()))
        case "keychain_set_secret":
            guard let account = text("account"), let secret = text("secret") else { return reply(.failure(BridgeError("Arguments manquants"))) }
            reply(attempt { try Keychain.set(account, secret); return NSNull() })
        case "keychain_get_secret":
            guard let account = text("account") else { return reply(.failure(BridgeError("Arguments manquants"))) }
            if account.hasPrefix(Self.protectedPrefix) { return reply(.failure(BridgeError("Ce secret exige une vérification biométrique"))) }
            reply(attempt { try Keychain.get(account) })
        case "keychain_delete_secret":
            guard let account = text("account") else { return reply(.failure(BridgeError("Arguments manquants"))) }
            reply(attempt { try Keychain.delete(account); return NSNull() })
        case "keychain_get_secret_verified":
            guard let account = text("account") else { return reply(.failure(BridgeError("Arguments manquants"))) }
            Biometry.verify(reason: text("reason") ?? "Déverrouiller BetterVault", allowPasscode: false) { error in
                if let error { return reply(.failure(BridgeError(error))) }
                reply(attempt { try Keychain.get(account) })
            }

        // ── Face ID / Touch ID (greffon biometric de Tauri, et forme « bureau ») ──
        case "plugin:biometric|status":
            reply(.success(Biometry.status()))
        case "plugin:biometric|authenticate":
            let allowPasscode = args["allowDeviceCredential"] as? Bool ?? false
            Biometry.verify(reason: text("reason") ?? "Déverrouiller BetterVault", allowPasscode: allowPasscode) { error in
                if let error { reply(.failure(BridgeError(error))) } else { reply(.success(NSNull())) }
            }
        case "desktop_biometric_status":
            reply(.success(Biometry.status()["isAvailable"] as? Bool ?? false))

        // ── Liens et fichiers ────────────────────────────────────────────
        case "plugin:opener|open_url":
            guard let raw = text("url"), let url = URL(string: raw), ["http", "https", "mailto"].contains(url.scheme?.lowercased() ?? "") else {
                return reply(.failure(BridgeError("Adresse non prise en charge")))
            }
            DispatchQueue.main.async {
                UIApplication.shared.open(url) { opened in
                    reply(opened ? .success(NSNull()) : .failure(BridgeError("Impossible d’ouvrir l’adresse")))
                }
            }
        case "save_export_file":
            guard let name = text("fileName"), let bytes = args["bytes"] as? [NSNumber] else { return reply(.failure(BridgeError("Arguments manquants"))) }
            reply(attempt { try AppStorage.saveExport(name: name, bytes: bytes) })

        case "native_call":
            reply(.failure(BridgeError("« \(text("method") ?? "") » n'est disponible que sur Android")))
        default:
            // derive_key_argon2 compris : la page utilise alors son Argon2id JavaScript
            reply(.failure(BridgeError("Commande native indisponible sur iOS : \(command)")))
        }
    }
}

// MARK: - Fichiers de l'application

enum AppStorage {
    /// Même nom de fichier que l'application Tauri (storage_file dans lib.rs)
    private static func storageFile() throws -> URL {
        let support = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        let dir = support.appendingPathComponent("app.bettervault", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("bettervault-storage.json")
    }

    static func readAll() throws -> [String: String] {
        let file = try storageFile()
        guard FileManager.default.fileExists(atPath: file.path) else { return [:] }
        let data = try Data(contentsOf: file)
        guard let entries = try JSONSerialization.jsonObject(with: data) as? [String: String] else {
            throw CocoaError(.fileReadCorruptFile)
        }
        return entries
    }

    /// Écriture atomique, fichier illisible tant que l'appareil n'a pas été déverrouillé une fois
    static func writeAll(_ entries: [String: String]) throws {
        let data = try JSONSerialization.data(withJSONObject: entries)
        try data.write(to: try storageFile(), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    /// Export dans Documents (visible dans l'app Fichiers) ; un fichier existant n'est jamais remplacé
    static func saveExport(name: String, bytes: [NSNumber]) throws -> String {
        let forbidden = CharacterSet(charactersIn: "/\\:*?\"<>|").union(.controlCharacters)
        var cleaned = String(name.unicodeScalars.filter { !forbidden.contains($0) })
            .trimmingCharacters(in: .whitespaces)
        while cleaned.hasPrefix(".") { cleaned.removeFirst() }
        guard !cleaned.isEmpty, cleaned.utf8.count <= 128 else { throw CocoaError(.fileWriteInvalidFileName) }

        let documents = try FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        let stem = (cleaned as NSString).deletingPathExtension
        let ext = (cleaned as NSString).pathExtension
        var target = documents.appendingPathComponent(cleaned)
        var counter = 1
        while FileManager.default.fileExists(atPath: target.path) {
            target = documents.appendingPathComponent(ext.isEmpty ? "\(stem) (\(counter))" : "\(stem) (\(counter)).\(ext)")
            counter += 1
        }

        let data = Data(bytes.map { UInt8(truncatingIfNeeded: $0.intValue) })
        try data.write(to: target, options: [.atomic, .completeFileProtection])
        return target.path
    }
}

// MARK: - Trousseau

enum Keychain {
    /// Même service que l'application Tauri (keyring::Entry::new(SERVICE, …))
    private static let service = "app.bettervault"
    private static let probeAccount = "__bettervault_keychain_probe__"

    struct Failure: Error {
        let message: String
    }

    private static func check(_ account: String) throws {
        guard !account.isEmpty, account.count <= 128 else {
            throw Failure(message: "Nom de compte trousseau invalide (1 à 128 caractères)")
        }
    }

    private static func query(_ account: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    }

    private static func failure(_ status: OSStatus) -> Failure {
        Failure(message: (SecCopyErrorMessageString(status, nil) as String?) ?? "Erreur du trousseau (\(status))")
    }

    static func set(_ account: String, _ secret: String) throws {
        try check(account)
        let data = Data(secret.utf8)
        // Jamais dans une sauvegarde iCloud ni sur un autre appareil
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        ]
        var status = SecItemUpdate(query(account) as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            status = SecItemAdd(query(account).merging(attributes) { $1 } as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw failure(status) }
    }

    static func get(_ account: String) throws -> String? {
        try check(account)
        var search = query(account)
        search[kSecReturnData as String] = true
        search[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(search as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = item as? Data else { throw failure(status) }
        return String(data: data, encoding: .utf8)
    }

    static func delete(_ account: String) throws {
        try check(account)
        let status = SecItemDelete(query(account) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw failure(status) }
    }

    static func isAvailable() -> Bool {
        do {
            try set(probeAccount, "probe")
            defer { try? delete(probeAccount) }
            return try get(probeAccount) == "probe"
        } catch {
            return false
        }
    }
}

// MARK: - Face ID / Touch ID

enum Biometry {
    /// Forme de tauri-plugin-biometric : isAvailable, biometryType (0 aucun, 1 Touch ID, 2 Face ID)
    static func status() -> [String: Any] {
        let context = LAContext()
        var error: NSError?
        let available = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error)
        let type: Int
        switch context.biometryType {
        case .touchID: type = 1
        case .faceID: type = 2
        default: type = 0
        }
        var result: [String: Any] = ["isAvailable": available, "biometryType": type]
        if let error { result["error"] = error.localizedDescription }
        return result
    }

    /// Appelle `done` avec nil si l'utilisateur est reconnu, sinon le motif (contient « cancel » s'il a annulé)
    static func verify(reason: String, allowPasscode: Bool, done: @escaping (String?) -> Void) {
        let context = LAContext()
        context.localizedFallbackTitle = allowPasscode ? nil : ""
        let policy: LAPolicy = allowPasscode ? .deviceOwnerAuthentication : .deviceOwnerAuthenticationWithBiometrics
        let shown = reason.isEmpty ? "Déverrouiller BetterVault" : String(reason.prefix(200))
        context.evaluatePolicy(policy, localizedReason: shown) { success, error in
            if success { return done(nil) }
            switch (error as? LAError)?.code {
            case .userCancel?, .systemCancel?, .appCancel?, .userFallback?:
                done("Authentification annulée (cancel)")
            default:
                done(error?.localizedDescription ?? "Authentification refusée")
            }
        }
    }
}
