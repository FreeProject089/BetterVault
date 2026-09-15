// Extension « Remplissage automatique des mots de passe » pour iOS (AutoFill Credential Provider).
//
// Ce fichier n'est pas compilé automatiquement : après `npm run tauri ios init`, ouvrez le projet Xcode,
// ajoutez une cible « AutoFill Credential Provider Extension », remplacez son contrôleur par ce fichier et
// activez le groupe d'applications « group.app.bettervault » sur l'application et sur l'extension.
// L'application écrit le cache (identifiants chiffrés) dans le trousseau partagé du groupe ; l'extension
// ne le lit qu'après Face ID / Touch ID.

import AuthenticationServices
import LocalAuthentication
import Security

struct AutofillEntry: Decodable {
    let title: String
    let username: String
    let password: String
    let domains: [String]
}

final class CredentialProviderViewController: ASCredentialProviderViewController {
    private let accessGroup = "group.app.bettervault"
    private let cacheAccount = "bettervault-autofill"

    /// iOS demande la liste des identifiants pour un site ou une application
    override func prepareCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier]) {
        let hosts = serviceIdentifiers.compactMap { host(of: $0.identifier) }
        authenticate { [weak self] entries in
            guard let self, let entries else {
                self?.extensionContext.cancelRequest(withError: NSError(domain: ASExtensionErrorDomain, code: ASExtensionError.userCanceled.rawValue))
                return
            }
            let matches = entries.filter { entry in
                hosts.contains { host in entry.domains.contains { host == $0 || host.hasSuffix("." + $0) } }
            }
            guard let first = matches.first else {
                self.extensionContext.cancelRequest(withError: NSError(domain: ASExtensionErrorDomain, code: ASExtensionError.credentialIdentityNotFound.rawValue))
                return
            }
            // Première correspondance : une liste de choix peut être ajoutée ici avec une table
            self.extensionContext.completeRequest(withSelectedCredential: ASPasswordCredential(user: first.username, password: first.password))
        }
    }

    private func host(of identifier: String) -> String? {
        let value = identifier.contains("://") ? identifier : "https://" + identifier
        return URL(string: value)?.host?.lowercased().replacingOccurrences(of: "www.", with: "")
    }

    private func authenticate(completion: @escaping ([AutofillEntry]?) -> Void) {
        let context = LAContext()
        context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: "Remplir avec BetterVault") { [weak self] success, _ in
            DispatchQueue.main.async {
                guard success, let self else { return completion(nil) }
                completion(self.readCache(context: context))
            }
        }
    }

    private func readCache(context: LAContext) -> [AutofillEntry]? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "app.bettervault",
            kSecAttrAccount as String: cacheAccount,
            kSecAttrAccessGroup as String: accessGroup,
            kSecUseAuthenticationContext as String: context,
            kSecReturnData as String: true
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
        return try? JSONDecoder().decode([AutofillEntry].self, from: data)
    }
}
