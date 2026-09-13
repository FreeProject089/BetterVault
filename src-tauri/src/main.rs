// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::command;
use argon2::{
    password_hash::{PasswordHasher, SaltString},
    Argon2, Params, Version
};
use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce
};
use rand::RngCore;

#[command]
fn get_system_status() -> String {
    "BUM E2EE Rust Core Ready (Argon2id + AES-256-GCM)".into()
}

#[command]
fn get_os_keychain_available() -> bool {
    // DPAPI (Windows) / Keychain (macOS) / SecretService (Linux)
    true
}

#[command]
fn derive_key_argon2(passphrase: String, salt: String) -> Result<String, String> {
    let params = Params::new(65536, 3, 4, Some(32)).map_err(|e| e.to_string())?;
    let argon2 = Argon2::new(argon2::Algorithm::Argon2id, Version::V0x13, params);
    
    let salt_str = SaltString::encode_b64(salt.as_bytes()).map_err(|e| e.to_string())?;
    let hash = argon2.hash_password(passphrase.as_bytes(), &salt_str).map_err(|e| e.to_string())?;
    
    Ok(hash.to_string())
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
            derive_key_argon2,
            generate_secure_bytes,
            encrypt_data_aes_gcm,
            decrypt_data_aes_gcm
        ])
        .run(tauri::generate_context!())
        .expect("error while running BUM tauri application");
}
