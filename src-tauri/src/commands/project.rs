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
