use std::sync::Mutex;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use serde::{Serialize, Deserialize};
use tauri::State;
use chrono::Utc;

#[derive(Clone, Serialize, Deserialize)]
pub struct KvEntry {
    pub value: String,
    pub created: String,
    pub modified: String,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct LogEntry {
    pub ts: String,
    pub tool: String,
    pub params: serde_json::Value,
    pub result: serde_json::Value,
    pub source: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum LaunchMode {
    Simple { file_path: Option<String> },
    Project { project_root: String, project_file: String, exists: bool },
}

#[derive(Default)]
pub struct ProjectState {
    pub project_root: Mutex<Option<String>>,
    pub project_file: Mutex<Option<String>>,
    pub open_file: Mutex<Option<String>>,
    pub memory: Mutex<String>,
    pub kv: Mutex<HashMap<String, KvEntry>>,
    pub log: Mutex<Vec<LogEntry>>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectData {
    pub version: u32,
    pub project_root: String,
    pub open_file: Option<String>,
    pub chat_history: serde_json::Value,
    pub memory: String,
    pub kv: HashMap<String, KvEntry>,
    pub log: Vec<LogEntry>,
    pub preferences: serde_json::Value,
}

#[derive(Serialize)]
pub struct KvSetResponse {
    pub success: bool,
    pub created: String,
    pub modified: String,
}

#[derive(Serialize)]
pub struct KvListEntry {
    pub key: String,
    pub modified: String,
}

#[derive(Serialize)]
pub struct KvListResponse {
    pub entries: Vec<KvListEntry>,
}

#[derive(Serialize)]
pub struct FileEntry {
    pub name: String,
    pub r#type: String, // "file" or "dir"
    pub size: u64,
}

#[derive(Serialize)]
pub struct FileListResponse {
    pub entries: Vec<FileEntry>,
}

#[derive(Serialize)]
pub struct FileStatResponse {
    pub size: u64,
    pub modified: String, // ISO 8601
    pub r#type: String,    // "file" or "dir"
}

// Helper: Safely resolve relative path within project root
fn safe_resolve(project_root: &Option<String>, relative_path: &str) -> Result<PathBuf, String> {
    let root_str = match project_root {
        Some(r) => r,
        None => return Err("No active project. File operations are only available in Project Mode.".to_string()),
    };

    let root_path = Path::new(root_str).canonicalize()
        .map_err(|e| format!("Failed to canonicalize project root: {}", e))?;

    // Join and normalize path
    let joined = root_path.join(relative_path.trim_start_matches('/'));

    // Check directory traversal by canonicalizing if it exists
    let canonical = if joined.exists() {
        joined.canonicalize().map_err(|e| format!("Failed to resolve path: {}", e))?
    } else {
        // If it doesn't exist, check parent path
        if let Some(parent) = joined.parent() {
            if parent.exists() {
                let canonical_parent = parent.canonicalize().map_err(|e| format!("Failed to resolve parent path: {}", e))?;
                if !canonical_parent.starts_with(&root_path) {
                    return Err("Access denied: path escapes project root".to_string());
                }
                canonical_parent.join(joined.file_name().unwrap_or_default())
            } else {
                joined
            }
        } else {
            joined
        }
    };

    if canonical.starts_with(&root_path) {
        Ok(canonical)
    } else {
        Err("Access denied: path escapes project root".to_string())
    }
}

#[tauri::command]
pub async fn project_init(
    state: State<'_, ProjectState>,
    root: String,
    file: String,
) -> Result<(), String> {
    let mut root_lock = state.project_root.lock().map_err(|e| e.to_string())?;
    let mut file_lock = state.project_file.lock().map_err(|e| e.to_string())?;
    let mut open_file_lock = state.open_file.lock().map_err(|e| e.to_string())?;
    let mut mem_lock = state.memory.lock().map_err(|e| e.to_string())?;
    let mut kv_lock = state.kv.lock().map_err(|e| e.to_string())?;
    let mut log_lock = state.log.lock().map_err(|e| e.to_string())?;

    *root_lock = Some(root);
    *file_lock = Some(file);
    *open_file_lock = None;
    *mem_lock = String::new();
    kv_lock.clear();
    log_lock.clear();

    Ok(())
}

#[tauri::command]
pub async fn project_load(
    state: State<'_, ProjectState>,
    path: String,
) -> Result<ProjectData, String> {
    let file_content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read project file: {}", e))?;

    let data: ProjectData = serde_json::from_str(&file_content)
        .map_err(|e| format!("Failed to parse project file: {}", e))?;

    // Update Rust-side state
    let mut root_lock = state.project_root.lock().map_err(|e| e.to_string())?;
    let mut file_lock = state.project_file.lock().map_err(|e| e.to_string())?;
    let mut open_file_lock = state.open_file.lock().map_err(|e| e.to_string())?;
    let mut mem_lock = state.memory.lock().map_err(|e| e.to_string())?;
    let mut kv_lock = state.kv.lock().map_err(|e| e.to_string())?;
    let mut log_lock = state.log.lock().map_err(|e| e.to_string())?;

    *root_lock = Some(data.project_root.clone());
    *file_lock = Some(path.clone());
    *open_file_lock = data.open_file.clone();
    *mem_lock = data.memory.clone();
    *kv_lock = data.kv.clone();
    *log_lock = data.log.clone();

    Ok(data)
}

#[tauri::command]
pub async fn project_save(
    state: State<'_, ProjectState>,
    open_file: Option<String>,
    chat_history: serde_json::Value,
    preferences: serde_json::Value,
) -> Result<(), String> {
    let root_lock = state.project_root.lock().map_err(|e| e.to_string())?;
    let file_lock = state.project_file.lock().map_err(|e| e.to_string())?;
    let mem_lock = state.memory.lock().map_err(|e| e.to_string())?;
    let kv_lock = state.kv.lock().map_err(|e| e.to_string())?;
    let log_lock = state.log.lock().map_err(|e| e.to_string())?;

    let path = match &*file_lock {
        Some(p) => p,
        None => return Err("No active project file to save to".to_string()),
    };

    let root = match &*root_lock {
        Some(r) => r.clone(),
        None => ".".to_string(),
    };

    let data = ProjectData {
        version: 1,
        project_root: root,
        open_file,
        chat_history,
        memory: mem_lock.clone(),
        kv: kv_lock.clone(),
        log: log_lock.clone(),
        preferences,
    };

    let serialized = serde_json::to_string_pretty(&data)
        .map_err(|e| format!("Failed to serialize project data: {}", e))?;

    std::fs::write(path, serialized)
        .map_err(|e| format!("Failed to write project file: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn set_open_file(
    state: State<'_, ProjectState>,
    path: Option<String>,
) -> Result<(), String> {
    let mut open_file_lock = state.open_file.lock().map_err(|e| e.to_string())?;
    *open_file_lock = path;
    Ok(())
}

#[tauri::command]
pub async fn memory_read(state: State<'_, ProjectState>) -> Result<String, String> {
    let mem_lock = state.memory.lock().map_err(|e| e.to_string())?;
    Ok(mem_lock.clone())
}

#[tauri::command]
pub async fn memory_write(state: State<'_, ProjectState>, content: String) -> Result<(), String> {
    let mut mem_lock = state.memory.lock().map_err(|e| e.to_string())?;
    *mem_lock = content;
    Ok(())
}

#[tauri::command]
pub async fn memory_append(state: State<'_, ProjectState>, content: String) -> Result<(), String> {
    let mut mem_lock = state.memory.lock().map_err(|e| e.to_string())?;
    mem_lock.push_str(&content);
    Ok(())
}

#[tauri::command]
pub async fn memory_clear(state: State<'_, ProjectState>) -> Result<(), String> {
    let mut mem_lock = state.memory.lock().map_err(|e| e.to_string())?;
    mem_lock.clear();
    Ok(())
}

#[tauri::command]
pub async fn kv_get(state: State<'_, ProjectState>, key: String) -> Result<Option<KvEntry>, String> {
    let kv_lock = state.kv.lock().map_err(|e| e.to_string())?;
    Ok(kv_lock.get(&key).cloned())
}

#[tauri::command]
pub async fn kv_set(
    state: State<'_, ProjectState>,
    key: String,
    value: String,
) -> Result<KvSetResponse, String> {
    let mut kv_lock = state.kv.lock().map_err(|e| e.to_string())?;
    let now = Utc::now().to_rfc3339();

    let (created, modified) = match kv_lock.get(&key) {
        Some(existing) => (existing.created.clone(), now.clone()),
        None => (now.clone(), now.clone()),
    };

    let entry = KvEntry {
        value,
        created: created.clone(),
        modified: modified.clone(),
    };

    kv_lock.insert(key, entry);

    Ok(KvSetResponse {
        success: true,
        created,
        modified,
    })
}

#[tauri::command]
pub async fn kv_delete(state: State<'_, ProjectState>, key: String) -> Result<bool, String> {
    let mut kv_lock = state.kv.lock().map_err(|e| e.to_string())?;
    Ok(kv_lock.remove(&key).is_some())
}

#[tauri::command]
pub async fn kv_list(state: State<'_, ProjectState>) -> Result<KvListResponse, String> {
    let kv_lock = state.kv.lock().map_err(|e| e.to_string())?;
    
    let mut entries: Vec<KvListEntry> = kv_lock
        .iter()
        .map(|(k, v)| KvListEntry {
            key: k.clone(),
            modified: v.modified.clone(),
        })
        .collect();

    // Sort by modified timestamp descending
    entries.sort_by(|a, b| b.modified.cmp(&a.modified));

    Ok(KvListResponse { entries })
}

#[tauri::command]
pub async fn log_tool_call(
    state: State<'_, ProjectState>,
    tool: String,
    params: serde_json::Value,
    result: serde_json::Value,
    source: String,
) -> Result<(), String> {
    let mut log_lock = state.log.lock().map_err(|e| e.to_string())?;
    let ts = Utc::now().to_rfc3339();
    
    log_lock.push(LogEntry {
        ts,
        tool,
        params,
        result,
        source,
    });
    
    Ok(())
}

#[tauri::command]
pub async fn file_read(state: State<'_, ProjectState>, path: String) -> Result<String, String> {
    let root_lock = state.project_root.lock().map_err(|e| e.to_string())?;
    let resolved = safe_resolve(&root_lock, &path)?;
    std::fs::read_to_string(resolved).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn file_write(
    state: State<'_, ProjectState>,
    path: String,
    content: String,
) -> Result<(), String> {
    let root_lock = state.project_root.lock().map_err(|e| e.to_string())?;
    let resolved = safe_resolve(&root_lock, &path)?;
    
    // Create parent directories if they don't exist
    if let Some(parent) = resolved.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    
    std::fs::write(resolved, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn file_list(
    state: State<'_, ProjectState>,
    path: Option<String>,
    recursive: Option<bool>,
) -> Result<FileListResponse, String> {
    let root_lock = state.project_root.lock().map_err(|e| e.to_string())?;
    
    let root_str = match &*root_lock {
        Some(r) => r,
        None => return Err("No active project. File operations are only available in Project Mode.".to_string()),
    };
    
    let rel_path = path.unwrap_or_default();
    let target_dir = safe_resolve(&root_lock, &rel_path)?;

    if !target_dir.is_dir() {
        return Err("Path is not a directory".to_string());
    }

    let mut entries = Vec::new();
    let recursive = recursive.unwrap_or(false);
    let project_root_path = Path::new(root_str).canonicalize().map_err(|e| e.to_string())?;

    fn visit_dirs(
        dir: &Path,
        root: &Path,
        recursive: bool,
        entries: &mut Vec<FileEntry>,
    ) -> Result<(), String> {
        if dir.is_dir() {
            for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
                let entry = entry.map_err(|e| e.to_string())?;
                let path = entry.path();
                
                // Get relative path to project root
                let name = path.strip_prefix(root)
                    .unwrap_or(&path)
                    .to_string_lossy()
                    .to_string();

                let metadata = entry.metadata().map_err(|e| e.to_string())?;
                let r#type = if metadata.is_dir() { "dir" } else { "file" }.to_string();
                let size = metadata.len();

                entries.push(FileEntry { name, r#type, size });

                if recursive && metadata.is_dir() {
                    visit_dirs(&path, root, recursive, entries)?;
                }
            }
        }
        Ok(())
    }

    visit_dirs(&target_dir, &project_root_path, recursive, &mut entries)?;

    Ok(FileListResponse { entries })
}

#[tauri::command]
pub async fn file_stat(state: State<'_, ProjectState>, path: String) -> Result<FileStatResponse, String> {
    let root_lock = state.project_root.lock().map_err(|e| e.to_string())?;
    let resolved = safe_resolve(&root_lock, &path)?;

    let metadata = std::fs::metadata(&resolved).map_err(|e| e.to_string())?;
    let r#type = if metadata.is_dir() { "dir" } else { "file" }.to_string();
    let size = metadata.len();

    let modified_time = metadata.modified().map_err(|e| e.to_string())?;
    let datetime: chrono::DateTime<chrono::Utc> = modified_time.into();
    let modified = datetime.to_rfc3339();

    Ok(FileStatResponse { size, modified, r#type })
}

#[tauri::command]
pub async fn screenshot_viewport() -> Result<String, String> {
    // Handled on JS side by capturing the actual preview pane element via canvas.
    // This Rust command acts as an IPC placeholder if needed.
    Ok("js_side_capture".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use std::thread;
    use std::time::Duration;

    // --- Inner test helpers (operate on ProjectState directly) ---

    fn memory_read_inner(state: &ProjectState) -> Result<String, String> {
        let mem_lock = state.memory.lock().map_err(|e| e.to_string())?;
        Ok(mem_lock.clone())
    }

    fn memory_write_inner(state: &ProjectState, content: String) -> Result<(), String> {
        let mut mem_lock = state.memory.lock().map_err(|e| e.to_string())?;
        *mem_lock = content;
        Ok(())
    }

    fn memory_append_inner(state: &ProjectState, content: String) -> Result<(), String> {
        let mut mem_lock = state.memory.lock().map_err(|e| e.to_string())?;
        mem_lock.push_str(&content);
        Ok(())
    }

    fn memory_clear_inner(state: &ProjectState) -> Result<(), String> {
        let mut mem_lock = state.memory.lock().map_err(|e| e.to_string())?;
        mem_lock.clear();
        Ok(())
    }

    fn kv_get_inner(state: &ProjectState, key: &str) -> Result<Option<KvEntry>, String> {
        let kv_lock = state.kv.lock().map_err(|e| e.to_string())?;
        Ok(kv_lock.get(key).cloned())
    }

    fn kv_set_inner(state: &ProjectState, key: String, value: String) -> Result<KvSetResponse, String> {
        let mut kv_lock = state.kv.lock().map_err(|e| e.to_string())?;
        let now = Utc::now().to_rfc3339();
        let (created, modified) = match kv_lock.get(&key) {
            Some(existing) => (existing.created.clone(), now.clone()),
            None => (now.clone(), now.clone()),
        };
        let entry = KvEntry {
            value,
            created: created.clone(),
            modified: modified.clone(),
        };
        kv_lock.insert(key, entry);
        Ok(KvSetResponse { success: true, created, modified })
    }

    fn kv_delete_inner(state: &ProjectState, key: &str) -> Result<bool, String> {
        let mut kv_lock = state.kv.lock().map_err(|e| e.to_string())?;
        Ok(kv_lock.remove(key).is_some())
    }

    fn kv_list_inner(state: &ProjectState) -> Result<KvListResponse, String> {
        let kv_lock = state.kv.lock().map_err(|e| e.to_string())?;
        let mut entries: Vec<KvListEntry> = kv_lock
            .iter()
            .map(|(k, v)| KvListEntry { key: k.clone(), modified: v.modified.clone() })
            .collect();
        entries.sort_by(|a, b| b.modified.cmp(&a.modified));
        Ok(KvListResponse { entries })
    }

    fn project_init_inner(state: &ProjectState, root: String, file: String) -> Result<(), String> {
        let mut root_lock = state.project_root.lock().map_err(|e| e.to_string())?;
        let mut file_lock = state.project_file.lock().map_err(|e| e.to_string())?;
        let mut open_file_lock = state.open_file.lock().map_err(|e| e.to_string())?;
        let mut mem_lock = state.memory.lock().map_err(|e| e.to_string())?;
        let mut kv_lock = state.kv.lock().map_err(|e| e.to_string())?;
        let mut log_lock = state.log.lock().map_err(|e| e.to_string())?;
        *root_lock = Some(root);
        *file_lock = Some(file);
        *open_file_lock = None;
        *mem_lock = String::new();
        kv_lock.clear();
        log_lock.clear();
        Ok(())
    }

    fn file_read_inner(state: &ProjectState, path: &str) -> Result<String, String> {
        let root_lock = state.project_root.lock().map_err(|e| e.to_string())?;
        let resolved = safe_resolve(&root_lock, path)?;
        std::fs::read_to_string(resolved).map_err(|e| e.to_string())
    }

    fn file_write_inner(state: &ProjectState, path: &str, content: &str) -> Result<(), String> {
        let root_lock = state.project_root.lock().map_err(|e| e.to_string())?;
        let resolved = safe_resolve(&root_lock, path)?;
        if let Some(parent) = resolved.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(resolved, content).map_err(|e| e.to_string())
    }

    fn file_list_inner(
        state: &ProjectState,
        path: Option<String>,
        recursive: Option<bool>,
    ) -> Result<FileListResponse, String> {
        let root_lock = state.project_root.lock().map_err(|e| e.to_string())?;
        let root_str = match &*root_lock {
            Some(r) => r,
            None => return Err("No active project. File operations are only available in Project Mode.".to_string()),
        };
        let rel_path = path.unwrap_or_default();
        let target_dir = safe_resolve(&root_lock, &rel_path)?;
        if !target_dir.is_dir() {
            return Err("Path is not a directory".to_string());
        }
        let mut entries = Vec::new();
        let recursive = recursive.unwrap_or(false);
        let project_root_path = Path::new(root_str).canonicalize().map_err(|e| e.to_string())?;

        fn visit_dirs(dir: &Path, root: &Path, recursive: bool, entries: &mut Vec<FileEntry>) -> Result<(), String> {
            if dir.is_dir() {
                for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
                    let entry = entry.map_err(|e| e.to_string())?;
                    let path = entry.path();
                    let name = path.strip_prefix(root).unwrap_or(&path).to_string_lossy().to_string();
                    let metadata = entry.metadata().map_err(|e| e.to_string())?;
                    let r#type = if metadata.is_dir() { "dir" } else { "file" }.to_string();
                    let size = metadata.len();
                    entries.push(FileEntry { name, r#type, size });
                    if recursive && metadata.is_dir() {
                        visit_dirs(&path, root, recursive, entries)?;
                    }
                }
            }
            Ok(())
        }

        visit_dirs(&target_dir, &project_root_path, recursive, &mut entries)?;
        Ok(FileListResponse { entries })
    }

    fn file_stat_inner(state: &ProjectState, path: &str) -> Result<FileStatResponse, String> {
        let root_lock = state.project_root.lock().map_err(|e| e.to_string())?;
        let resolved = safe_resolve(&root_lock, path)?;
        let metadata = std::fs::metadata(&resolved).map_err(|e| e.to_string())?;
        let r#type = if metadata.is_dir() { "dir" } else { "file" }.to_string();
        let size = metadata.len();
        let modified_time = metadata.modified().map_err(|e| e.to_string())?;
        let datetime: chrono::DateTime<chrono::Utc> = modified_time.into();
        let modified = datetime.to_rfc3339();
        Ok(FileStatResponse { size, modified, r#type })
    }

    fn state_with_root(root: &str) -> ProjectState {
        let state = ProjectState::default();
        *state.project_root.lock().unwrap() = Some(root.to_string());
        state
    }

    // --- safe_resolve tests ---

    #[test]
    fn safe_resolve_no_project_root() {
        let result = safe_resolve(&None, "test.txt");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("No active project"));
    }

    #[test]
    fn safe_resolve_valid_relative_path() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().to_string_lossy().to_string();
        std::fs::write(tmp.path().join("hello.txt"), "hi").unwrap();
        let result = safe_resolve(&Some(root), "hello.txt");
        assert!(result.is_ok());
        assert!(result.unwrap().ends_with("hello.txt"));
    }

    #[test]
    fn safe_resolve_directory_traversal_blocked() {
        // Create two sibling temp dirs: one as root, one as the escape target
        let tmp_root = TempDir::new().unwrap();
        let tmp_outside = TempDir::new().unwrap();
        let outside_file = tmp_outside.path().join("secret.txt");
        std::fs::write(&outside_file, "secret").unwrap();

        let root = tmp_root.path().to_string_lossy().to_string();
        // Build a relative path that traverses out of root to the outside dir
        let escape_path = format!(
            "../{}",
            tmp_outside.path().file_name().unwrap().to_string_lossy()
        );
        let result = safe_resolve(&Some(root), &format!("{}/secret.txt", escape_path));
        assert!(result.is_err(), "Expected error but got: {:?}", result);
        assert!(result.unwrap_err().contains("Access denied"));
    }

    #[test]
    fn safe_resolve_leading_slash_stripped() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().to_string_lossy().to_string();
        std::fs::write(tmp.path().join("test.txt"), "data").unwrap();
        let result = safe_resolve(&Some(root), "/test.txt");
        assert!(result.is_ok());
    }

    #[test]
    fn safe_resolve_nonexistent_file_valid_parent() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().to_string_lossy().to_string();
        let result = safe_resolve(&Some(root), "nonexistent.txt");
        assert!(result.is_ok());
    }

    // --- Memory tests ---

    #[test]
    fn memory_write_then_read_round_trip() {
        let state = ProjectState::default();
        memory_write_inner(&state, "hello world".to_string()).unwrap();
        let result = memory_read_inner(&state).unwrap();
        assert_eq!(result, "hello world");
    }

    #[test]
    fn memory_append_accumulates() {
        let state = ProjectState::default();
        memory_write_inner(&state, "first".to_string()).unwrap();
        memory_append_inner(&state, " second".to_string()).unwrap();
        let result = memory_read_inner(&state).unwrap();
        assert_eq!(result, "first second");
    }

    #[test]
    fn memory_clear_empties() {
        let state = ProjectState::default();
        memory_write_inner(&state, "data".to_string()).unwrap();
        memory_clear_inner(&state).unwrap();
        let result = memory_read_inner(&state).unwrap();
        assert_eq!(result, "");
    }

    // --- KV tests ---

    #[test]
    fn kv_set_creates_with_identical_timestamps() {
        let state = ProjectState::default();
        let resp = kv_set_inner(&state, "key1".to_string(), "val1".to_string()).unwrap();
        assert!(resp.success);
        assert_eq!(resp.created, resp.modified);
    }

    #[test]
    fn kv_set_existing_preserves_created_updates_modified() {
        let state = ProjectState::default();
        let resp1 = kv_set_inner(&state, "key1".to_string(), "val1".to_string()).unwrap();
        // Small delay to ensure different timestamp
        thread::sleep(Duration::from_millis(10));
        let resp2 = kv_set_inner(&state, "key1".to_string(), "val2".to_string()).unwrap();
        assert_eq!(resp2.created, resp1.created);
        assert!(resp2.modified >= resp1.modified);
    }

    #[test]
    fn kv_get_existing_key() {
        let state = ProjectState::default();
        kv_set_inner(&state, "mykey".to_string(), "myval".to_string()).unwrap();
        let entry = kv_get_inner(&state, "mykey").unwrap();
        assert!(entry.is_some());
        assert_eq!(entry.unwrap().value, "myval");
    }

    #[test]
    fn kv_get_missing_key() {
        let state = ProjectState::default();
        let entry = kv_get_inner(&state, "nonexistent").unwrap();
        assert!(entry.is_none());
    }

    #[test]
    fn kv_delete_existing_returns_true() {
        let state = ProjectState::default();
        kv_set_inner(&state, "key1".to_string(), "val1".to_string()).unwrap();
        let deleted = kv_delete_inner(&state, "key1").unwrap();
        assert!(deleted);
        assert!(kv_get_inner(&state, "key1").unwrap().is_none());
    }

    #[test]
    fn kv_delete_missing_returns_false() {
        let state = ProjectState::default();
        let deleted = kv_delete_inner(&state, "nope").unwrap();
        assert!(!deleted);
    }

    #[test]
    fn kv_list_sorts_by_modified_descending() {
        let state = ProjectState::default();
        kv_set_inner(&state, "a".to_string(), "1".to_string()).unwrap();
        thread::sleep(Duration::from_millis(10));
        kv_set_inner(&state, "b".to_string(), "2".to_string()).unwrap();
        thread::sleep(Duration::from_millis(10));
        kv_set_inner(&state, "c".to_string(), "3".to_string()).unwrap();

        let list = kv_list_inner(&state).unwrap();
        assert_eq!(list.entries.len(), 3);
        // Most recently modified first
        assert_eq!(list.entries[0].key, "c");
        assert_eq!(list.entries[1].key, "b");
        assert_eq!(list.entries[2].key, "a");
    }

    // --- File operations tests (real filesystem via tempfile) ---

    #[test]
    fn file_write_and_read_round_trip() {
        let tmp = TempDir::new().unwrap();
        let state = state_with_root(&tmp.path().to_string_lossy());
        file_write_inner(&state, "test.txt", "hello file").unwrap();
        let content = file_read_inner(&state, "test.txt").unwrap();
        assert_eq!(content, "hello file");
    }

    #[test]
    fn file_write_creates_parent_directories() {
        let tmp = TempDir::new().unwrap();
        let state = state_with_root(&tmp.path().to_string_lossy());
        file_write_inner(&state, "sub/dir/test.txt", "nested").unwrap();
        let content = file_read_inner(&state, "sub/dir/test.txt").unwrap();
        assert_eq!(content, "nested");
    }

    #[test]
    fn file_list_non_recursive() {
        let tmp = TempDir::new().unwrap();
        std::fs::write(tmp.path().join("a.txt"), "a").unwrap();
        std::fs::create_dir(tmp.path().join("subdir")).unwrap();
        std::fs::write(tmp.path().join("subdir/b.txt"), "b").unwrap();

        let state = state_with_root(&tmp.path().to_string_lossy());
        let result = file_list_inner(&state, None, Some(false)).unwrap();
        let names: Vec<&str> = result.entries.iter().map(|e| e.name.as_str()).collect();
        assert!(names.contains(&"a.txt"));
        assert!(names.contains(&"subdir"));
        // b.txt should not appear (non-recursive)
        assert!(!names.iter().any(|n| n.contains("b.txt")));
    }

    #[test]
    fn file_list_recursive() {
        let tmp = TempDir::new().unwrap();
        std::fs::write(tmp.path().join("a.txt"), "a").unwrap();
        std::fs::create_dir(tmp.path().join("subdir")).unwrap();
        std::fs::write(tmp.path().join("subdir/b.txt"), "b").unwrap();

        let state = state_with_root(&tmp.path().to_string_lossy());
        let result = file_list_inner(&state, None, Some(true)).unwrap();
        let names: Vec<&str> = result.entries.iter().map(|e| e.name.as_str()).collect();
        assert!(names.contains(&"a.txt"));
        assert!(names.iter().any(|n| n.contains("b.txt")));
    }

    #[test]
    fn file_stat_returns_correct_metadata() {
        let tmp = TempDir::new().unwrap();
        std::fs::write(tmp.path().join("stat.txt"), "12345").unwrap();
        let state = state_with_root(&tmp.path().to_string_lossy());
        let stat = file_stat_inner(&state, "stat.txt").unwrap();
        assert_eq!(stat.size, 5);
        assert_eq!(stat.r#type, "file");
        assert!(!stat.modified.is_empty());
    }

    #[test]
    fn file_stat_directory() {
        let tmp = TempDir::new().unwrap();
        std::fs::create_dir(tmp.path().join("mydir")).unwrap();
        let state = state_with_root(&tmp.path().to_string_lossy());
        let stat = file_stat_inner(&state, "mydir").unwrap();
        assert_eq!(stat.r#type, "dir");
    }

    #[test]
    fn project_init_clears_state() {
        let tmp = TempDir::new().unwrap();
        let state = ProjectState::default();
        // Set up some state
        memory_write_inner(&state, "data".to_string()).unwrap();
        kv_set_inner(&state, "k".to_string(), "v".to_string()).unwrap();

        // Init clears everything
        project_init_inner(&state, tmp.path().to_string_lossy().to_string(), "file.prj".to_string()).unwrap();
        assert_eq!(memory_read_inner(&state).unwrap(), "");
        assert!(kv_get_inner(&state, "k").unwrap().is_none());
        assert!(state.project_root.lock().unwrap().is_some());
    }

    #[test]
    fn project_save_and_load_round_trip() {
        let tmp = TempDir::new().unwrap();
        let prj_file = tmp.path().join("test.prj");
        let state = ProjectState::default();
        *state.project_root.lock().unwrap() = Some(tmp.path().to_string_lossy().to_string());
        *state.project_file.lock().unwrap() = Some(prj_file.to_string_lossy().to_string());
        memory_write_inner(&state, "saved memory".to_string()).unwrap();
        kv_set_inner(&state, "saved_key".to_string(), "saved_val".to_string()).unwrap();

        // Save
        let data = ProjectData {
            version: 1,
            project_root: tmp.path().to_string_lossy().to_string(),
            open_file: Some("readme.md".to_string()),
            chat_history: serde_json::json!([]),
            memory: "saved memory".to_string(),
            kv: state.kv.lock().unwrap().clone(),
            log: vec![],
            preferences: serde_json::json!({}),
        };
        let serialized = serde_json::to_string_pretty(&data).unwrap();
        std::fs::write(&prj_file, &serialized).unwrap();

        // Load into fresh state
        let state2 = ProjectState::default();
        let file_content = std::fs::read_to_string(&prj_file).unwrap();
        let loaded: ProjectData = serde_json::from_str(&file_content).unwrap();
        *state2.project_root.lock().unwrap() = Some(loaded.project_root.clone());
        *state2.memory.lock().unwrap() = loaded.memory.clone();
        *state2.kv.lock().unwrap() = loaded.kv.clone();

        assert_eq!(memory_read_inner(&state2).unwrap(), "saved memory");
        assert_eq!(kv_get_inner(&state2, "saved_key").unwrap().unwrap().value, "saved_val");
        assert_eq!(loaded.open_file, Some("readme.md".to_string()));
    }

    #[test]
    fn file_list_no_project_root() {
        let state = ProjectState::default();
        let result = file_list_inner(&state, None, None);
        assert!(result.is_err());
    }
}
