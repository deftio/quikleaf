use std::sync::Mutex;
use tauri::State;

/// Holds the file path passed via CLI args
pub struct CliFile(pub Mutex<Option<String>>);

/// Save content to a file at the given path
#[tauri::command]
pub async fn save_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, &content).map_err(|e| format!("Failed to save file: {}", e))
}

/// Read a file's contents by path
#[tauri::command]
pub async fn read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {}", e))
}

/// Get the file path passed via CLI, if any
#[tauri::command]
pub async fn get_cli_file(state: State<'_, CliFile>) -> Result<Option<String>, String> {
    let lock = state.0.lock().map_err(|e| e.to_string())?;
    Ok(lock.clone())
}
