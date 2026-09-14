use tauri::{command, Manager};
use argon2::{Algorithm, Argon2, Params, Version};
use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce
};
use rand::RngCore;

#[command]
fn get_system_status() -> String {
    "BetterVault core ready".into()
}

/// Trousseau du système (Windows Credential Manager / macOS Keychain / Secret Service)
#[cfg(not(mobile))]
mod keychain {
    use tauri::command;

    const SERVICE: &str = "app.bettervault";
    const PROBE_ACCOUNT: &str = "__bettervault_keychain_probe__";

    fn entry(account: &str) -> Result<keyring::Entry, String> {
        if account.is_empty() || account.len() > 128 {
            return Err("Nom de compte trousseau invalide (1 à 128 caractères)".into());
        }
        keyring::Entry::new(SERVICE, account).map_err(|e| e.to_string())
    }

    #[command]
    pub fn get_os_keychain_available() -> bool {
        let Ok(entry) = entry(PROBE_ACCOUNT) else { return false };
        if entry.set_password("probe").is_err() {
            return false;
        }
        let readable = matches!(entry.get_password(), Ok(ref value) if value == "probe");
        let _ = entry.delete_credential();
        readable
    }

    #[command]
    pub fn keychain_set_secret(account: String, secret: String) -> Result<(), String> {
        entry(&account)?.set_password(&secret).map_err(|e| e.to_string())
    }

    #[command]
    pub fn keychain_get_secret(account: String) -> Result<Option<String>, String> {
        match entry(&account)?.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    #[command]
    pub fn keychain_delete_secret(account: String) -> Result<(), String> {
        match entry(&account)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

/// Sur Android et iOS, le trousseau n'est pas encore relié : l'interface le signale comme indisponible
#[cfg(mobile)]
mod keychain {
    use tauri::command;

    const UNAVAILABLE: &str = "Trousseau du système non disponible sur mobile";

    #[command]
    pub fn get_os_keychain_available() -> bool {
        false
    }

    #[command]
    pub fn keychain_set_secret(_account: String, _secret: String) -> Result<(), String> {
        Err(UNAVAILABLE.into())
    }

    #[command]
    pub fn keychain_get_secret(_account: String) -> Result<Option<String>, String> {
        Ok(None)
    }

    #[command]
    pub fn keychain_delete_secret(_account: String) -> Result<(), String> {
        Ok(())
    }
}

use keychain::{get_os_keychain_available, keychain_delete_secret, keychain_get_secret, keychain_set_secret};

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

/// Enregistre un export dans le dossier Téléchargements : les liens de téléchargement HTML
/// ne fonctionnent pas dans la webview. Ne remplace jamais un fichier existant.
/// Fichier du compte et du coffre chiffré, dans le dossier de données de l'application :
/// Windows %APPDATA%\app.bettervault, macOS ~/Library/Application Support/app.bettervault,
/// Linux ~/.local/share/app.bettervault, Android et iOS : stockage privé de l'application.
fn storage_file(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("bettervault-storage.json"))
}

#[command]
fn storage_read_all(app: tauri::AppHandle) -> Result<std::collections::HashMap<String, String>, String> {
    let path = storage_file(&app)?;
    match std::fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text).map_err(|e| format!("Fichier de stockage illisible : {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(std::collections::HashMap::new()),
        Err(e) => Err(e.to_string()),
    }
}

/// Écriture atomique : fichier temporaire puis renommage, pour ne jamais laisser un fichier à moitié écrit
#[command]
fn storage_write_all(app: tauri::AppHandle, entries: std::collections::HashMap<String, String>) -> Result<(), String> {
    let path = storage_file(&app)?;
    let temp = path.with_extension("json.tmp");
    let json = serde_json::to_string(&entries).map_err(|e| e.to_string())?;
    std::fs::write(&temp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&temp, &path).map_err(|e| e.to_string())
}

#[command]
fn save_export_file(app: tauri::AppHandle, file_name: String, bytes: Vec<u8>) -> Result<String, String> {
    let cleaned: String = file_name
        .chars()
        .filter(|c| !c.is_control() && !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        .collect();
    let cleaned = cleaned.trim().trim_start_matches('.').to_string();
    if cleaned.is_empty() || cleaned.len() > 128 {
        return Err("Nom de fichier invalide".into());
    }

    let dir = app.path().download_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let name_path = std::path::Path::new(&cleaned);
    let stem = name_path.file_stem().and_then(|s| s.to_str()).unwrap_or("export").to_string();
    let extension = name_path.extension().and_then(|s| s.to_str()).map(|e| format!(".{e}")).unwrap_or_default();

    let mut target = dir.join(&cleaned);
    let mut counter = 1;
    while target.exists() {
        target = dir.join(format!("{stem} ({counter}){extension}"));
        counter += 1;
    }

    std::fs::write(&target, bytes).map_err(|e| e.to_string())?;
    Ok(target.to_string_lossy().into_owned())
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_system_status,
            get_os_keychain_available,
            keychain_set_secret,
            keychain_get_secret,
            keychain_delete_secret,
            derive_key_argon2,
            save_export_file,
            storage_read_all,
            storage_write_all,
            generate_secure_bytes,
            encrypt_data_aes_gcm,
            decrypt_data_aes_gcm
        ])
        .run(tauri::generate_context!())
        .expect("error while running BetterVault");
}
