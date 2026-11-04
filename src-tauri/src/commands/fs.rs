use std::path::{Path, PathBuf};
use std::sync::Mutex;
use base64::Engine;
use serde::Serialize;
use tauri::State;
use tauri_plugin_fs::FsExt;

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

/// Let the fs plugin read and write `path`. The plugin's default scope is the
/// app's own folders; the Open dialog widens it for files picked there and
/// `setup()` for the command-line file. A file dropped onto the window comes
/// from neither, so the frontend asks for it here before `readTextFile`.
#[tauri::command]
pub async fn allow_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    app.fs_scope().allow_file(&path).map_err(|e| e.to_string())
}

/// The image MIME type for `path`'s extension, or None when it is not an
/// image. The `asset://` handler serves only files this accepts.
pub fn image_mime(path: &Path) -> Option<&'static str> {
    match path.extension().and_then(|s| s.to_str()).map(|s| s.to_ascii_lowercase()).as_deref() {
        Some("png") => Some("image/png"),
        Some("jpg") | Some("jpeg") => Some("image/jpeg"),
        Some("gif") => Some("image/gif"),
        Some("svg") => Some("image/svg+xml"),
        Some("webp") => Some("image/webp"),
        Some("bmp") => Some("image/bmp"),
        Some("avif") => Some("image/avif"),
        _ => None,
    }
}

#[derive(Serialize, Debug)]
pub struct ImageSaved {
    /// Path to put in the markdown: relative to the document's folder, forward slashes.
    pub relative: String,
    pub absolute: String,
}

/// Where a pasted image goes: `images/<document stem>-<timestamp>.<ext>` beside
/// `doc_path`, with a counter suffix if that name is taken.
pub fn pasted_image_path(doc_path: &Path, ext: &str, stamp: &str) -> PathBuf {
    let dir = doc_path.parent().unwrap_or_else(|| Path::new(".")).join("images");
    let stem = doc_path.file_stem().and_then(|s| s.to_str()).unwrap_or("image");
    let mut candidate = dir.join(format!("{}-{}.{}", stem, stamp, ext));
    let mut n = 2;
    while candidate.exists() {
        candidate = dir.join(format!("{}-{}-{}.{}", stem, stamp, n, ext));
        n += 1;
    }
    candidate
}

fn write_image(doc_path: &str, ext: &str, bytes: &[u8]) -> Result<ImageSaved, String> {
    let ext = ext.trim_start_matches('.').to_ascii_lowercase();
    if image_mime(Path::new(&format!("x.{}", ext))).is_none() {
        return Err(format!("Not an image type: {}", ext));
    }
    let doc = Path::new(doc_path);
    if !doc.is_absolute() {
        return Err("The document needs a saved location first".to_string());
    }
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
    let target = pasted_image_path(doc, &ext, &stamp);
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create images folder: {}", e))?;
    }
    std::fs::write(&target, bytes).map_err(|e| format!("Failed to write image: {}", e))?;
    let relative = format!("images/{}", target.file_name().unwrap_or_default().to_string_lossy());
    Ok(ImageSaved { relative, absolute: target.to_string_lossy().to_string() })
}

/// Save an image pasted or dropped into a document, beside that document
/// (`images/` folder). `data` is base64 (no data-URL prefix).
#[tauri::command]
pub async fn image_save(doc_path: String, ext: String, data: String) -> Result<ImageSaved, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.as_bytes())
        .map_err(|e| format!("Bad image data: {}", e))?;
    if bytes.is_empty() {
        return Err("Empty image".to_string());
    }
    write_image(&doc_path, &ext, &bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn image_mime_knows_images_only() {
        assert_eq!(image_mime(Path::new("a.PNG")), Some("image/png"));
        assert_eq!(image_mime(Path::new("a.jpeg")), Some("image/jpeg"));
        assert_eq!(image_mime(Path::new("a.svg")), Some("image/svg+xml"));
        assert_eq!(image_mime(Path::new("a.md")), None);
        assert_eq!(image_mime(Path::new("noext")), None);
    }

    #[test]
    fn pasted_image_goes_beside_the_document_and_never_overwrites() {
        let tmp = TempDir::new().unwrap();
        let doc = tmp.path().join("notes.md");
        let first = pasted_image_path(&doc, "png", "20260101-120000");
        assert_eq!(first, tmp.path().join("images").join("notes-20260101-120000.png"));
        std::fs::create_dir_all(first.parent().unwrap()).unwrap();
        std::fs::write(&first, b"x").unwrap();
        let second = pasted_image_path(&doc, "png", "20260101-120000");
        assert_eq!(second.file_name().unwrap(), "notes-20260101-120000-2.png");
    }

    #[test]
    fn write_image_creates_the_folder_and_reports_a_relative_path() {
        let tmp = TempDir::new().unwrap();
        let doc = tmp.path().join("sub").join("doc.md");
        std::fs::create_dir_all(doc.parent().unwrap()).unwrap();
        let saved = write_image(&doc.to_string_lossy(), ".PNG", b"\x89PNG").unwrap();
        assert!(saved.relative.starts_with("images/doc-"));
        assert!(saved.relative.ends_with(".png"));
        assert_eq!(std::fs::read(&saved.absolute).unwrap(), b"\x89PNG");
        assert!(Path::new(&saved.absolute).starts_with(tmp.path().join("sub").join("images")));
    }

    #[test]
    fn write_image_refuses_non_images_and_unsaved_documents() {
        let tmp = TempDir::new().unwrap();
        let doc = tmp.path().join("doc.md");
        assert!(write_image(&doc.to_string_lossy(), "exe", b"MZ").unwrap_err().contains("Not an image"));
        assert!(write_image("Untitled", "png", b"x").unwrap_err().contains("saved location"));
    }

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
