//! Diagnostics: the performance log and the command-line shim installer.
//!
//! The performance log is a JSON-lines file in the platform log directory
//! (macOS: `~/Library/Logs/com.deftio.quikleaf/quikleaf-perf.jsonl`,
//! Linux: `~/.local/share/com.deftio.quikleaf/logs/`, Windows:
//! `%LOCALAPPDATA%\com.deftio.quikleaf\logs\`). The frontend decides *whether*
//! to log (Settings → "Write performance log"); this module only appends,
//! tails, clears and reveals the file.

use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use tauri::Manager;

pub const LOG_FILE_NAME: &str = "quikleaf-perf.jsonl";

fn log_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_log_dir()
        .map_err(|e| format!("Cannot resolve log directory: {}", e))?;
    fs::create_dir_all(&dir).map_err(|e| format!("Cannot create log directory: {}", e))?;
    Ok(dir)
}

fn log_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(log_dir(app)?.join(LOG_FILE_NAME))
}

/// Append one JSON object as a line. Adds an RFC 3339 `ts` when missing.
pub fn append_line(path: &Path, entry: &serde_json::Value) -> Result<(), String> {
    let mut obj = match entry {
        serde_json::Value::Object(m) => m.clone(),
        other => {
            let mut m = serde_json::Map::new();
            m.insert("value".into(), other.clone());
            m
        }
    };
    if !obj.contains_key("ts") {
        obj.insert("ts".into(), serde_json::Value::String(chrono::Utc::now().to_rfc3339()));
    }
    let line = serde_json::to_string(&serde_json::Value::Object(obj)).map_err(|e| e.to_string())?;
    let mut f = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|e| format!("Cannot open log: {}", e))?;
    writeln!(f, "{}", line).map_err(|e| format!("Cannot write log: {}", e))
}

/// Last `n` parseable JSON lines, oldest first.
pub fn tail_lines(path: &Path, n: usize) -> Result<Vec<serde_json::Value>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let f = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut keep: std::collections::VecDeque<serde_json::Value> = std::collections::VecDeque::with_capacity(n + 1);
    for line in BufReader::new(f).lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => continue,
        };
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) {
            keep.push_back(v);
            if keep.len() > n {
                keep.pop_front();
            }
        }
    }
    Ok(keep.into_iter().collect())
}

#[tauri::command]
pub async fn log_get_path(app: tauri::AppHandle) -> Result<String, String> {
    Ok(log_file(&app)?.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn log_append(app: tauri::AppHandle, entry: serde_json::Value) -> Result<(), String> {
    append_line(&log_file(&app)?, &entry)
}

#[tauri::command]
pub async fn log_tail(app: tauri::AppHandle, n: usize) -> Result<Vec<serde_json::Value>, String> {
    tail_lines(&log_file(&app)?, n.clamp(1, 1000))
}

#[tauri::command]
pub async fn log_clear(app: tauri::AppHandle) -> Result<(), String> {
    let path = log_file(&app)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Open the log directory in the platform file manager.
#[tauri::command]
pub async fn log_reveal(app: tauri::AppHandle) -> Result<(), String> {
    let dir = log_dir(&app)?;
    let (cmd, args): (&str, Vec<String>) = if cfg!(target_os = "macos") {
        ("open", vec![dir.to_string_lossy().to_string()])
    } else if cfg!(target_os = "windows") {
        ("explorer", vec![dir.to_string_lossy().to_string()])
    } else {
        ("xdg-open", vec![dir.to_string_lossy().to_string()])
    };
    std::process::Command::new(cmd)
        .args(&args)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Cannot open {}: {}", dir.display(), e))
}

// ---------------------------------------------------------------------------
// Command-line shim
// ---------------------------------------------------------------------------

#[derive(Clone, Serialize)]
pub struct CliStatus {
    /// Platform supports installing a shim from inside the app.
    pub supported: bool,
    /// A `quikleaf` shim pointing at this binary exists.
    pub installed: bool,
    /// Where the shim is (or would be) written.
    pub path: Option<String>,
    /// The shim directory is on the current PATH.
    pub on_path: bool,
    /// Human-readable note (how to add the directory to PATH, errors, ...).
    pub note: String,
}

/// The shell script written to the bin directory. It `exec`s the real binary
/// so `quikleaf file.md` keeps the caller's working directory for relative
/// paths; add `&` to return to the prompt immediately.
pub fn shim_script(exe: &Path) -> String {
    format!(
        "#!/bin/sh\n# quikleaf command-line shim — installed from the app (Help → Install Command Line Tool).\n# Re-run that menu item after moving quikleaf.app.\nexec \"{}\" \"$@\"\n",
        exe.display()
    )
}

/// Directories to try, in order of preference. Only existing, writable ones
/// are used; `~/.local/bin` is created when nothing else works.
pub fn candidate_dirs(home: &Path) -> Vec<PathBuf> {
    vec![
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/opt/homebrew/bin"),
        home.join(".local").join("bin"),
    ]
}

pub fn dir_on_path(dir: &Path, path_env: &str) -> bool {
    let sep = if cfg!(windows) { ';' } else { ':' };
    path_env.split(sep).any(|p| Path::new(p) == dir)
}

fn is_writable_dir(dir: &Path) -> bool {
    if !dir.is_dir() {
        return false;
    }
    let probe = dir.join(".quikleaf-write-test");
    match fs::File::create(&probe) {
        Ok(_) => {
            let _ = fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

fn home_dir() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

fn current_exe() -> Result<PathBuf, String> {
    std::env::current_exe().map_err(|e| format!("Cannot locate the quikleaf binary: {}", e))
}

fn path_env() -> String {
    std::env::var("PATH").unwrap_or_default()
}

fn shim_points_here(shim: &Path, exe: &Path) -> bool {
    fs::read_to_string(shim)
        .map(|s| s.contains(&exe.display().to_string()))
        .unwrap_or(false)
}

fn find_installed_shim(exe: &Path) -> Option<PathBuf> {
    let home = home_dir();
    candidate_dirs(&home)
        .into_iter()
        .map(|d| d.join("quikleaf"))
        .find(|p| p.exists() && shim_points_here(p, exe))
}

#[tauri::command]
pub async fn cli_status() -> Result<CliStatus, String> {
    if cfg!(target_os = "windows") {
        return Ok(CliStatus {
            supported: false,
            installed: false,
            path: None,
            on_path: false,
            note: "On Windows the installer adds quikleaf to the Start menu; add the install folder to PATH manually to use it from a terminal.".into(),
        });
    }
    let exe = current_exe()?;
    let path_env = path_env();
    match find_installed_shim(&exe) {
        Some(shim) => {
            let dir = shim.parent().unwrap_or(Path::new("/"));
            let on_path = dir_on_path(dir, &path_env);
            Ok(CliStatus {
                supported: true,
                installed: true,
                path: Some(shim.to_string_lossy().to_string()),
                on_path,
                note: if on_path {
                    "Installed. Run `quikleaf file.md` or `quikleaf --project ./dir` from a terminal.".into()
                } else {
                    format!("Installed, but {} is not on your PATH yet.", dir.display())
                },
            })
        }
        None => Ok(CliStatus {
            supported: true,
            installed: false,
            path: None,
            on_path: false,
            note: "Not installed. Use Help → Install Command Line Tool.".into(),
        }),
    }
}

#[tauri::command]
pub async fn cli_install() -> Result<CliStatus, String> {
    if cfg!(target_os = "windows") {
        return Err("Installing a command-line shim is not supported on Windows yet.".into());
    }
    let exe = current_exe()?;
    let home = home_dir();
    let candidates = candidate_dirs(&home);

    let mut target_dir: Option<PathBuf> = candidates.iter().find(|d| is_writable_dir(d)).cloned();
    if target_dir.is_none() {
        let local = home.join(".local").join("bin");
        fs::create_dir_all(&local).map_err(|e| format!("Cannot create {}: {}", local.display(), e))?;
        if is_writable_dir(&local) {
            target_dir = Some(local);
        }
    }
    let dir = target_dir.ok_or_else(|| {
        "No writable bin directory found (tried /usr/local/bin, /opt/homebrew/bin, ~/.local/bin).".to_string()
    })?;

    let shim = dir.join("quikleaf");
    fs::write(&shim, shim_script(&exe)).map_err(|e| format!("Cannot write {}: {}", shim.display(), e))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&shim, fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
    }

    let on_path = dir_on_path(&dir, &path_env());
    Ok(CliStatus {
        supported: true,
        installed: true,
        path: Some(shim.to_string_lossy().to_string()),
        on_path,
        note: if on_path {
            format!("Installed {}. Open a new terminal and run `quikleaf file.md`.", shim.display())
        } else {
            format!(
                "Installed {}. Add it to your PATH, e.g. `export PATH=\"{}:$PATH\"` in your shell profile.",
                shim.display(),
                dir.display()
            )
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn append_adds_timestamp_and_tail_returns_newest_last() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("perf.jsonl");
        append_line(&path, &serde_json::json!({"kind": "llm", "total_ms": 120})).unwrap();
        append_line(&path, &serde_json::json!({"kind": "tool", "ts": "2026-01-01T00:00:00Z"})).unwrap();
        append_line(&path, &serde_json::json!({"kind": "llm", "total_ms": 300})).unwrap();

        let all = tail_lines(&path, 10).unwrap();
        assert_eq!(all.len(), 3);
        assert!(all[0]["ts"].is_string(), "ts added when missing");
        assert_eq!(all[1]["ts"], "2026-01-01T00:00:00Z", "existing ts preserved");

        let last = tail_lines(&path, 1).unwrap();
        assert_eq!(last.len(), 1);
        assert_eq!(last[0]["total_ms"], 300);
    }

    #[test]
    fn tail_skips_garbage_lines_and_missing_file() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("perf.jsonl");
        assert!(tail_lines(&path, 5).unwrap().is_empty());
        fs::write(&path, "{\"a\":1}\nnot json\n\n{\"a\":2}\n").unwrap();
        let v = tail_lines(&path, 5).unwrap();
        assert_eq!(v.len(), 2);
        assert_eq!(v[1]["a"], 2);
    }

    #[test]
    fn non_object_entries_are_wrapped() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("perf.jsonl");
        append_line(&path, &serde_json::json!("hello")).unwrap();
        let v = tail_lines(&path, 1).unwrap();
        assert_eq!(v[0]["value"], "hello");
    }

    #[test]
    fn shim_execs_the_binary_with_args() {
        let s = shim_script(Path::new("/Applications/quikleaf.app/Contents/MacOS/quikleaf"));
        assert!(s.starts_with("#!/bin/sh\n"));
        assert!(s.contains("exec \"/Applications/quikleaf.app/Contents/MacOS/quikleaf\" \"$@\""));
    }

    #[test]
    fn path_membership_is_exact_segment_match() {
        assert!(dir_on_path(Path::new("/usr/local/bin"), "/usr/bin:/usr/local/bin:/bin"));
        assert!(!dir_on_path(Path::new("/usr/local/bin"), "/usr/bin:/usr/local/binx:/bin"));
        assert!(!dir_on_path(Path::new("/usr/local/bin"), ""));
    }

    #[test]
    fn candidates_prefer_system_dirs_then_home() {
        let c = candidate_dirs(Path::new("/Users/me"));
        assert_eq!(c[0], PathBuf::from("/usr/local/bin"));
        assert_eq!(c.last().unwrap(), &PathBuf::from("/Users/me/.local/bin"));
    }
}
