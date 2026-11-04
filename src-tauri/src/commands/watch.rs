//! File watching for the Watch toggle and `quikleaf --watch`.
//!
//! The frontend asks to watch a document's absolute path; when that file
//! changes on disk the hub emits a `file-changed` event (`{ path, kind }`)
//! and the frontend reloads the tab. Parent folders are watched rather than
//! the files themselves: editors that save by writing a temp file and
//! renaming it over the original would otherwise detach the watch.

use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::State;

pub const FILE_CHANGED: &str = "file-changed";

#[derive(Clone, Debug, serde::Serialize)]
pub struct FileChanged {
    /// The watched path, as the frontend gave it.
    pub path: String,
    /// "changed" (written, created, renamed into place) or "removed".
    pub kind: String,
}

struct Watched {
    /// Canonical path → the path as the frontend named it (what the event reports back).
    files: HashMap<PathBuf, String>,
    /// Watched parent folders and how many files each serves.
    dirs: HashMap<PathBuf, usize>,
}

pub struct WatchHub {
    watched: Arc<Mutex<Watched>>,
    watcher: Mutex<Option<RecommendedWatcher>>,
    sink: Arc<dyn Fn(FileChanged) + Send + Sync>,
}

/// Which watched file an event is about, if any, and what happened to it.
pub fn classify(watched: &HashMap<PathBuf, String>, event: &Event) -> Vec<FileChanged> {
    let kind = match event.kind {
        EventKind::Remove(_) => "removed",
        EventKind::Create(_) | EventKind::Modify(_) | EventKind::Any | EventKind::Other => "changed",
        EventKind::Access(_) => return Vec::new(),
    };
    let mut out = Vec::new();
    for p in &event.paths {
        let canonical = p.canonicalize().unwrap_or_else(|_| p.clone());
        if let Some(original) = watched.get(&canonical) {
            out.push(FileChanged { path: original.clone(), kind: kind.to_string() });
        }
    }
    out
}

impl WatchHub {
    pub fn new(sink: impl Fn(FileChanged) + Send + Sync + 'static) -> Self {
        WatchHub {
            watched: Arc::new(Mutex::new(Watched { files: HashMap::new(), dirs: HashMap::new() })),
            watcher: Mutex::new(None),
            sink: Arc::new(sink),
        }
    }

    fn watcher(&self) -> Result<std::sync::MutexGuard<'_, Option<RecommendedWatcher>>, String> {
        let mut guard = self.watcher.lock().map_err(|e| e.to_string())?;
        if guard.is_none() {
            let watched = Arc::clone(&self.watched);
            let sink = Arc::clone(&self.sink);
            let w = RecommendedWatcher::new(
                move |res: notify::Result<Event>| {
                    if let Ok(event) = res {
                        let hits = match watched.lock() {
                            Ok(w) => classify(&w.files, &event),
                            Err(_) => Vec::new(),
                        };
                        for hit in hits {
                            sink(hit);
                        }
                    }
                },
                Config::default(),
            )
            .map_err(|e| format!("Cannot create file watcher: {}", e))?;
            *guard = Some(w);
        }
        Ok(guard)
    }

    /// Start reporting changes to `path`. Idempotent.
    pub fn start(&self, path: &str) -> Result<(), String> {
        let file = Path::new(path);
        let canonical = file.canonicalize().map_err(|e| format!("Cannot watch {}: {}", path, e))?;
        let dir = canonical.parent().ok_or_else(|| "Cannot watch a path with no folder".to_string())?.to_path_buf();
        let mut guard = self.watcher()?;
        let mut w = self.watched.lock().map_err(|e| e.to_string())?;
        if w.files.insert(canonical.clone(), path.to_string()).is_some() {
            return Ok(());
        }
        let count = w.dirs.entry(dir.clone()).or_insert(0);
        *count += 1;
        if *count == 1 {
            guard
                .as_mut()
                .unwrap()
                .watch(&dir, RecursiveMode::NonRecursive)
                .map_err(|e| format!("Cannot watch {}: {}", dir.display(), e))?;
        }
        Ok(())
    }

    /// Stop reporting changes to `path`. Unknown paths are ignored.
    pub fn stop(&self, path: &str) -> Result<(), String> {
        let canonical = Path::new(path).canonicalize().unwrap_or_else(|_| PathBuf::from(path));
        let mut w = self.watched.lock().map_err(|e| e.to_string())?;
        if w.files.remove(&canonical).is_none() {
            return Ok(());
        }
        if let Some(dir) = canonical.parent().map(|d| d.to_path_buf()) {
            let done = match w.dirs.get_mut(&dir) {
                Some(n) => {
                    *n -= 1;
                    *n == 0
                }
                None => false,
            };
            if done {
                w.dirs.remove(&dir);
                if let Ok(mut guard) = self.watcher.lock() {
                    if let Some(watcher) = guard.as_mut() {
                        let _ = watcher.unwatch(&dir);
                    }
                }
            }
        }
        Ok(())
    }

    #[cfg(test)]
    pub fn watched_paths(&self) -> Vec<String> {
        self.watched.lock().map(|w| w.files.values().cloned().collect()).unwrap_or_default()
    }
}

#[tauri::command]
pub async fn watch_start(hub: State<'_, WatchHub>, path: String) -> Result<(), String> {
    hub.start(&path)
}

#[tauri::command]
pub async fn watch_stop(hub: State<'_, WatchHub>, path: String) -> Result<(), String> {
    hub.stop(&path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;
    use tempfile::TempDir;

    fn wait_for(rx: &mpsc::Receiver<FileChanged>, path: &str, kind: &str) -> bool {
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while std::time::Instant::now() < deadline {
            match rx.recv_timeout(Duration::from_millis(200)) {
                Ok(ev) if ev.path == path && ev.kind == kind => return true,
                Ok(_) => continue,
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(_) => return false,
            }
        }
        false
    }

    #[test]
    fn classify_reports_only_watched_files_with_the_frontend_path() {
        let tmp = TempDir::new().unwrap();
        let file = tmp.path().join("a.md");
        std::fs::write(&file, "x").unwrap();
        let mut watched = HashMap::new();
        watched.insert(file.canonicalize().unwrap(), "/as/given/a.md".to_string());

        let mut ev = Event::new(EventKind::Modify(notify::event::ModifyKind::Any));
        ev.paths = vec![file.clone(), tmp.path().join("other.md")];
        let hits = classify(&watched, &ev);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].path, "/as/given/a.md");
        assert_eq!(hits[0].kind, "changed");

        let mut rm = Event::new(EventKind::Remove(notify::event::RemoveKind::Any));
        rm.paths = vec![file.clone()];
        assert_eq!(classify(&watched, &rm)[0].kind, "removed");

        let mut access = Event::new(EventKind::Access(notify::event::AccessKind::Any));
        access.paths = vec![file];
        assert!(classify(&watched, &access).is_empty());
    }

    #[test]
    fn start_and_stop_track_files_and_folders() {
        let tmp = TempDir::new().unwrap();
        let a = tmp.path().join("a.md");
        let b = tmp.path().join("b.md");
        std::fs::write(&a, "a").unwrap();
        std::fs::write(&b, "b").unwrap();
        let hub = WatchHub::new(|_| {});
        hub.start(a.to_str().unwrap()).unwrap();
        hub.start(a.to_str().unwrap()).unwrap(); // idempotent
        hub.start(b.to_str().unwrap()).unwrap();
        let mut paths = hub.watched_paths();
        paths.sort();
        assert_eq!(paths, vec![a.to_string_lossy().to_string(), b.to_string_lossy().to_string()]);
        assert_eq!(hub.watched.lock().unwrap().dirs.len(), 1);
        hub.stop(a.to_str().unwrap()).unwrap();
        assert_eq!(hub.watched.lock().unwrap().dirs.len(), 1);
        hub.stop(b.to_str().unwrap()).unwrap();
        assert!(hub.watched.lock().unwrap().dirs.is_empty());
        hub.stop("/never/watched.md").unwrap();
        assert!(hub.start(tmp.path().join("missing.md").to_str().unwrap()).is_err());
    }

    #[test]
    fn a_write_to_a_watched_file_reaches_the_sink() {
        let tmp = TempDir::new().unwrap();
        let file = tmp.path().join("watched.md");
        std::fs::write(&file, "v1").unwrap();
        let (tx, rx) = mpsc::channel();
        let hub = WatchHub::new(move |c| {
            let _ = tx.send(c);
        });
        let given = file.to_string_lossy().to_string();
        hub.start(&given).unwrap();
        std::thread::sleep(Duration::from_millis(300)); // let the watcher settle (FSEvents latency)
        std::fs::write(&file, "v2").unwrap();
        assert!(wait_for(&rx, &given, "changed"), "no change event for {}", given);
        hub.stop(&given).unwrap();
    }
}
