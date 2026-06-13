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

#[cfg(test)]
mod tests {
    use tempfile::TempDir;

    fn save_file_inner(path: &str, content: &str) -> Result<(), String> {
        std::fs::write(path, content).map_err(|e| format!("Failed to save file: {}", e))
    }

    fn read_file_inner(path: &str) -> Result<String, String> {
        std::fs::read_to_string(path).map_err(|e| format!("Failed to read file: {}", e))
    }

    #[test]
    fn save_and_read_round_trip() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("test.md");
        let path_str = path.to_string_lossy().to_string();

        save_file_inner(&path_str, "# Hello World\n\nThis is a test.").unwrap();
        let content = read_file_inner(&path_str).unwrap();
        assert_eq!(content, "# Hello World\n\nThis is a test.");
    }

    #[test]
    fn read_nonexistent_file_returns_error() {
        let result = read_file_inner("/tmp/definitely_does_not_exist_quikleaf_test.txt");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Failed to read file"));
    }

    #[test]
    fn save_to_invalid_directory_returns_error() {
        let result = save_file_inner("/nonexistent_dir_quikleaf_test/foo/bar.txt", "content");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Failed to save file"));
    }

    #[test]
    fn save_overwrites_existing() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("overwrite.txt");
        let path_str = path.to_string_lossy().to_string();

        save_file_inner(&path_str, "first").unwrap();
        save_file_inner(&path_str, "second").unwrap();
        let content = read_file_inner(&path_str).unwrap();
        assert_eq!(content, "second");
    }

    #[test]
    fn save_and_read_empty_file() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("empty.txt");
        let path_str = path.to_string_lossy().to_string();

        save_file_inner(&path_str, "").unwrap();
        let content = read_file_inner(&path_str).unwrap();
        assert_eq!(content, "");
    }

    #[test]
    fn save_and_read_unicode() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("unicode.txt");
        let path_str = path.to_string_lossy().to_string();

        let unicode_content = "# こんにちは 🌍\n\nEmoji: 🦀 Rust is fast!";
        save_file_inner(&path_str, unicode_content).unwrap();
        let content = read_file_inner(&path_str).unwrap();
        assert_eq!(content, unicode_content);
    }
}
