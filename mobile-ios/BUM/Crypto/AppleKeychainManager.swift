import Foundation
import CryptoKit
import Security

/// Gestionnaire de Chiffrement Matériel iOS (Secure Enclave / Keychain)
public final class AppleKeychainManager {
    public static let shared = AppleKeychainManager()
    private let serviceTag = "com.bum.vault.keys"

    private init() {}

    /// Chiffre les données en AES-GCM 256 bits avec une clé dérivée sécurisée
    public func encryptData(_ data: Data, using key: SymmetricKey) throws -> (Data, Data) {
        let sealedBox = try AES.GCM.seal(data, using: key)
        guard let combined = sealedBox.combined else {
            throw NSError(domain: "BUMCrypto", code: -1, userInfo: [NSLocalizedDescriptionKey: "Erreur de chiffrement GCM"])
        }
        return (sealedBox.nonce.withUnsafeBytes { Data($0) }, combined)
    }

    /// Déchiffre les données chiffrées avec la clé symétrique
    public func decryptData(combinedData: Data, using key: SymmetricKey) throws -> Data {
        let sealedBox = try AES.GCM.SealedBox(combined: combinedData)
        return try AES.GCM.open(sealedBox, using: key)
    }

    /// Sauvegarde sécurisée dans le Keychain iOS (avec protection kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly)
    public func saveSecret(key: String, value: String) -> Bool {
        guard let data = value.data(using: .utf8) else { return false }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceTag,
            kSecAttrAccount as String: key,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        ]
        SecItemDelete(query as CFDictionary)
        let status = SecItemAdd(query as CFDictionary, nil)
        return status == errSecSuccess
    }

    /// Lecture sécurisée depuis le Keychain iOS
    public func loadSecret(key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceTag,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var item: CFTypeRef?
        if SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
           let data = item as? Data {
            return String(data: data, encoding: .utf8)
        }
        return nil
    }
}
