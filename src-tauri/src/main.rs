// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::command;
use argon2::{Algorithm, Argon2, Params, Version};
use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce
};
use rand::RngCore;

/// Service sous lequel les secrets sont rangés dans le trousseau du système
const KEYCHAIN_SERVICE: &str = "app.bettervault";
const KEYCHAIN_PROBE_ACCOUNT: &str = "__bettervault_keychain_probe__";

#[command]
fn get_system_status() -> String {
    "BetterVault core ready".into()
}

fn keychain_entry(account: &str) -> Result<keyring::Entry, String> {
    if account.is_empty() || account.len() > 128 {
        return Err("Nom de compte trousseau invalide (1 à 128 caractères)".into());
    }
    keyring::Entry::new(KEYCHAIN_SERVICE, account).map_err(|e| e.to_string())
}

/// Vérifie réellement l'accès au trousseau (Windows Credential Manager / macOS Keychain / Secret Service)
#[command]
fn get_os_keychain_available() -> bool {
    let Ok(entry) = keychain_entry(KEYCHAIN_PROBE_ACCOUNT) else { return false };
    if entry.set_password("probe").is_err() {
        return false;
    }
    let readable = matches!(entry.get_password(), Ok(ref value) if value == "probe");
    let _ = entry.delete_credential();
    readable
}

#[command]
fn keychain_set_secret(account: String, secret: String) -> Result<(), String> {
    keychain_entry(&account)?.set_password(&secret).map_err(|e| e.to_string())
}

#[command]
fn keychain_get_secret(account: String) -> Result<Option<String>, String> {
    match keychain_entry(&account)?.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[command]
fn keychain_delete_secret(account: String) -> Result<(), String> {
    match keychain_entry(&account)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Dérive une clé brute de 32 octets avec Argon2id (identique à l'implémentation JS @noble/hashes)
#[command]
fn derive_key_argon2(
    passphrase: String,
    salt: Vec<u8>,
    memory_kib: u32,
    iterations: u32,
    parallelism: u32,
) -> Result<Vec<u8>, String> {
    if salt.len() < 8 {
        return Err("Le sel Argon2id doit contenir au moins 8 octets".into());
    }
    if memory_kib > (1 << 21) {
        return Err("Mémoire Argon2id trop élevée (2 Gio maximum)".into());
    }
    let params = Params::new(memory_kib, iterations, parallelism, Some(32)).map_err(|e| e.to_string())?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);

    let mut key = vec![0u8; 32];
    argon2
        .hash_password_into(passphrase.as_bytes(), &salt, &mut key)
        .map_err(|e| e.to_string())?;
    Ok(key)
}

#[command]
fn generate_secure_bytes(count: usize) -> Vec<u8> {
    let mut bytes = vec![0u8; count];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes
}

#[command]
fn encrypt_data_aes_gcm(plaintext: String, key_bytes: Vec<u8>) -> Result<(Vec<u8>, Vec<u8>), String> {
    if key_bytes.len() != 32 {
        return Err("La clé AES-256 doit être exactement de 32 octets (256 bits)".into());
    }
    let key = aes_gcm::Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);

    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher.encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| format!("Erreur de chiffrement: {:?}", e))?;

    Ok((nonce_bytes.to_vec(), ciphertext))
}

#[command]
fn decrypt_data_aes_gcm(ciphertext: Vec<u8>, nonce_bytes: Vec<u8>, key_bytes: Vec<u8>) -> Result<String, String> {
    if key_bytes.len() != 32 {
        return Err("La clé AES-256 doit être de 32 octets".into());
    }
    if nonce_bytes.len() != 12 {
        return Err("Le nonce AES-GCM doit être de 12 octets".into());
    }
    let key = aes_gcm::Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let decrypted = cipher.decrypt(nonce, ciphertext.as_ref())
        .map_err(|e| format!("Échec du déchiffrement: {:?}", e))?;

    String::from_utf8(decrypted).map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_system_status,
            get_os_keychain_available,
            keychain_set_secret,
            keychain_get_secret,
            keychain_delete_secret,
            derive_key_argon2,
            generate_secure_bytes,
            encrypt_data_aes_gcm,
            decrypt_data_aes_gcm
        ])
        .run(tauri::generate_context!())
        .expect("error while running BetterVault");
}
