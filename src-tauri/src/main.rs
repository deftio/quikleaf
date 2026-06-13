// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

use commands::project::{ProjectState, LaunchMode};
use std::path::{Path, PathBuf};
use tauri::Manager;

pub struct LaunchInfo(pub LaunchMode);

/// Parse CLI args from a provided slice (testable without std::env::args).
pub fn parse_cli_args_from(args: &[String], cwd: &Path) -> LaunchMode {
    // Check for --project
    if let Some(pos) = args.iter().position(|x| x == "--project") {
        if pos + 1 < args.len() {
            let path_str = &args[pos + 1];
            let path = Path::new(path_str);
            let absolute_path = if path.is_absolute() {
                path.to_path_buf()
            } else {
                cwd.join(path)
            };

            // Check if it's a directory
            if absolute_path.is_dir() {
                let prj_file = absolute_path.join("quikleaf.prj");
                let exists = prj_file.exists();
                return LaunchMode::Project {
                    project_root: absolute_path.to_string_lossy().to_string(),
                    project_file: prj_file.to_string_lossy().to_string(),
                    exists,
                };
            } else {
                // Assume it's a project file
                let prj_file = absolute_path.clone();
                let parent = absolute_path.parent().unwrap_or_else(|| Path::new("."));
                let exists = prj_file.exists();
                return LaunchMode::Project {
                    project_root: parent.to_string_lossy().to_string(),
                    project_file: prj_file.to_string_lossy().to_string(),
                    exists,
                };
            }
        }
    }

    // Check for single file
    let file_arg = args.iter().skip(1).find(|arg| !arg.starts_with('-'));
    if let Some(arg) = file_arg {
        let path = Path::new(arg);
        let absolute_path = if path.is_absolute() {
            path.to_path_buf()
        } else {
            cwd.join(path)
        };
        return LaunchMode::Simple {
            file_path: Some(absolute_path.to_string_lossy().to_string()),
        };
    }

    LaunchMode::Simple { file_path: None }
}

fn parse_cli_args() -> LaunchMode {
    let args: Vec<String> = std::env::args().collect();
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    parse_cli_args_from(&args, &cwd)
}

#[tauri::command]
async fn get_launch_info(state: tauri::State<'_, LaunchInfo>) -> Result<LaunchMode, String> {
    Ok(state.0.clone())
}

fn main() {
    let launch_mode = parse_cli_args();

    let project_state = ProjectState::default();
    
    // In Simple Mode, if we have a file path, pre-populate open_file in state
    if let LaunchMode::Simple { file_path: Some(ref path) } = launch_mode {
        if let Ok(mut open_file_lock) = project_state.open_file.lock() {
            *open_file_lock = Some(path.clone());
        }
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .manage(LaunchInfo(launch_mode))
        .manage(project_state)
        .register_asynchronous_uri_scheme_protocol("asset".to_string(), move |ctx, request, responder| {
            let state = ctx.app_handle().state::<ProjectState>();
            let uri = request.uri();
            let path_str = uri.path();
            
            // simple percent decode
            let mut decoded_path = String::new();
            let mut chars = path_str.chars();
            while let Some(c) = chars.next() {
                if c == '%' {
                    let h1 = chars.next();
                    let h2 = chars.next();
                    if let (Some(c1), Some(c2)) = (h1, h2) {
                        if let Ok(hex) = u8::from_str_radix(&format!("{}{}", c1, c2), 16) {
                            decoded_path.push(hex as char);
                            continue;
                        }
                    }
                }
                decoded_path.push(c);
            }
            
            let resolved_path = {
                let root_lock = state.project_root.lock().unwrap();
                let file_lock = state.open_file.lock().unwrap();
                if let Some(root) = &*root_lock {
                    std::path::Path::new(root).join(decoded_path.trim_start_matches('/'))
                } else if let Some(file) = &*file_lock {
                    let file_path = std::path::Path::new(file);
                    if let Some(parent) = file_path.parent() {
                        parent.join(decoded_path.trim_start_matches('/'))
                    } else {
                        std::path::PathBuf::from(".").join(decoded_path.trim_start_matches('/'))
                    }
                } else {
                    std::path::PathBuf::from(decoded_path.trim_start_matches('/'))
                }
            };
            
            std::thread::spawn(move || {
                match std::fs::read(&resolved_path) {
                    Ok(content) => {
                        let mime = match resolved_path.extension().and_then(|s| s.to_str()) {
                            Some("png") => "image/png",
                            Some("jpg") | Some("jpeg") => "image/jpeg",
                            Some("gif") => "image/gif",
                            Some("svg") => "image/svg+xml",
                            Some("webp") => "image/webp",
                            _ => "application/octet-stream",
                        };
                        let response = tauri::http::Response::builder()
                            .header(tauri::http::header::CONTENT_TYPE, mime)
                            .body(content)
                            .unwrap();
                        responder.respond(response);
                    }
                    Err(_) => {
                        let response = tauri::http::Response::builder()
                            .status(404)
                            .body(Vec::<u8>::new())
                            .unwrap();
                        responder.respond(response);
                    }
                }
            });
        })
        .invoke_handler(tauri::generate_handler![
            commands::fs::save_file,
            commands::fs::read_file,
            commands::fs::get_cli_file,
            commands::llm::llm_chat,
            commands::llm::llm_chat_stream,
            commands::llm::llm_list_models,
            get_launch_info,
            commands::project::project_init,
            commands::project::project_load,
            commands::project::project_save,
            commands::project::set_open_file,
            commands::project::memory_read,
            commands::project::memory_write,
            commands::project::memory_append,
            commands::project::memory_clear,
            commands::project::kv_get,
            commands::project::kv_set,
            commands::project::kv_delete,
            commands::project::kv_list,
            commands::project::log_tool_call,
            commands::project::file_read,
            commands::project::file_write,
            commands::project::file_list,
            commands::project::file_stat,
            commands::project::screenshot_viewport,
        ])
        .run(tauri::generate_context!())
        .expect("error while running quikleaf");
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn args(strs: &[&str]) -> Vec<String> {
        strs.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn no_args_returns_simple_none() {
        let cwd = PathBuf::from("/tmp");
        let mode = parse_cli_args_from(&args(&["quikleaf"]), &cwd);
        match mode {
            LaunchMode::Simple { file_path } => assert!(file_path.is_none()),
            _ => panic!("Expected Simple"),
        }
    }

    #[test]
    fn file_arg_returns_simple_with_path() {
        let cwd = PathBuf::from("/home/user");
        let mode = parse_cli_args_from(&args(&["quikleaf", "readme.md"]), &cwd);
        match mode {
            LaunchMode::Simple { file_path } => {
                let p = file_path.unwrap();
                assert!(p.contains("readme.md"));
                assert!(p.starts_with("/home/user"));
            }
            _ => panic!("Expected Simple"),
        }
    }

    #[test]
    fn absolute_file_arg_preserved() {
        let cwd = PathBuf::from("/tmp");
        let mode = parse_cli_args_from(&args(&["quikleaf", "/absolute/path.md"]), &cwd);
        match mode {
            LaunchMode::Simple { file_path } => {
                assert_eq!(file_path.unwrap(), "/absolute/path.md");
            }
            _ => panic!("Expected Simple"),
        }
    }

    #[test]
    fn project_flag_with_directory() {
        let tmp = TempDir::new().unwrap();
        let dir_str = tmp.path().to_string_lossy().to_string();
        let cwd = PathBuf::from("/tmp");
        let mode = parse_cli_args_from(&args(&["quikleaf", "--project", &dir_str]), &cwd);
        match mode {
            LaunchMode::Project { project_root, project_file, exists } => {
                assert!(project_root.contains(&dir_str) || project_root.contains(tmp.path().file_name().unwrap().to_str().unwrap()));
                assert!(project_file.contains("quikleaf.prj"));
                assert!(!exists); // No prj file created yet
            }
            _ => panic!("Expected Project"),
        }
    }

    #[test]
    fn project_flag_with_file_uses_parent_as_root() {
        let tmp = TempDir::new().unwrap();
        let prj_file = tmp.path().join("myproject.prj");
        std::fs::write(&prj_file, "{}").unwrap();
        let prj_str = prj_file.to_string_lossy().to_string();
        let cwd = PathBuf::from("/tmp");
        let mode = parse_cli_args_from(&args(&["quikleaf", "--project", &prj_str]), &cwd);
        match mode {
            LaunchMode::Project { project_root, project_file, exists } => {
                assert!(project_root.contains(tmp.path().file_name().unwrap().to_str().unwrap()));
                assert!(project_file.contains("myproject.prj"));
                assert!(exists);
            }
            _ => panic!("Expected Project"),
        }
    }

    #[test]
    fn flags_skipped_when_finding_file_arg() {
        let cwd = PathBuf::from("/home/user");
        let mode = parse_cli_args_from(&args(&["quikleaf", "--verbose", "readme.md"]), &cwd);
        match mode {
            LaunchMode::Simple { file_path } => {
                let p = file_path.unwrap();
                assert!(p.contains("readme.md"));
                // --verbose should be skipped
                assert!(!p.contains("verbose"));
            }
            _ => panic!("Expected Simple"),
        }
    }

    #[test]
    fn project_flag_without_value_falls_through() {
        let cwd = PathBuf::from("/tmp");
        let mode = parse_cli_args_from(&args(&["quikleaf", "--project"]), &cwd);
        match mode {
            LaunchMode::Simple { file_path } => assert!(file_path.is_none()),
            _ => panic!("Expected Simple fallback"),
        }
    }
}
