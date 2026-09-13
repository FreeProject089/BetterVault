// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::command;

#[command]
fn get_system_status() -> String {
    "BUM E2EE Rust Core Ready".into()
}

#[command]
fn get_os_keychain_available() -> bool {
    // DPAPI (Windows) / Keychain (macOS) / SecretService (Linux)
    true
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_system_status,
            get_os_keychain_available
        ])
        .run(tauri::generate_context!())
        .expect("error while running BUM tauri application");
}
