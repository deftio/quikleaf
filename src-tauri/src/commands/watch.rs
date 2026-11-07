//! File watching for the Watch toggle and `quikleaf --watch`.
//!
//! The frontend asks to watch a document's absolute path; when that file
//! changes on disk the hub emits a `file-changed` event (`{ path, kind }`)
//! and the frontend reloads the tab. Parent folders are watched rather than
//! the files themselves: editors that save by writing a temp file and
//! renaming it over the original would otherwise detach the watch.
//!
//! Two sources feed the same sink. The OS watcher (notify: FSEvents, inotify,
//! ReadDirectoryChanges) is immediate, but it only sees writes the kernel
//! reports: a file written through a network share, a sync client, or the
//! shared folder of a sandboxed agent arrives with no event. A poller stats
//! every watched file every `POLL_INTERVAL` and reports a changed size or
//! mtime, so those writes are noticed too, a little later. The frontend
//! coalesces the two (a short debounce, and a reload is skipped when the text
//! is unchanged), so a write seen by both costs one extra read.

use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};
use tauri::State;

/// How often the fallback poller stats the watched files.
pub const POLL_INTERVAL: Duration = Duration::from_millis(1500);

pub const FILE_CHANGED: &str = "file-changed";

#[derive(Clone, Debug, serde::Serialize)]
pub struct FileChanged {
    /// The watched path, as the frontend gave it.
    pub path: String,
    /// "changed" (written, created, renamed into place) or "removed".
    pub kind: String,
}

/// What the poller compares between passes. `None` from `stamp` means the
/// file is missing (or unreadable).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Stamp {
    modified: Option<SystemTime>,
    len: u64,
}

pub fn stamp(path: &Path) -> Option<Stamp> {
    std::fs::metadata(path).ok().map(|m| Stamp { modified: m.modified().ok(), len: m.len() })
}

struct Watched {
    /// Canonical path → the path as the frontend named it (what the event reports back).
    files: HashMap<PathBuf, String>,
    /// Watched parent folders and how many files each serves.
    dirs: HashMap<PathBuf, usize>,
    /// What the last pass saw for each watched file (`None`: missing then).
    seen: HashMap<PathBuf, Option<Stamp>>,
}

impl Watched {
    fn new() -> Self {
        Watched { files: HashMap::new(), dirs: HashMap::new(), seen: HashMap::new() }
    }

    /// Record the file's current size and mtime as the poller's baseline, so
    /// a change the OS watcher already reported is not reported twice.
    fn refresh(&mut self, canonical: &Path) {
        if self.files.contains_key(canonical) {
            self.seen.insert(canonical.to_path_buf(), stamp(canonical));
        }
    }
}

/// One pass of the polling fallback: report every watched file whose size or
/// mtime differs from the last pass, and files that went missing or came back.
fn poll_once(w: &mut Watched) -> Vec<FileChanged> {
    let mut out = Vec::new();
    for (canonical, original) in &w.files {
        let now = stamp(canonical);
        let kind = match (w.seen.get(canonical).copied(), now) {
            (Some(Some(before)), Some(after)) if before != after => Some("changed"),
            (Some(None), Some(_)) => Some("changed"),
            (Some(Some(_)), None) => Some("removed"),
            _ => None,
        };
        if let Some(kind) = kind {
            out.push(FileChanged { path: original.clone(), kind: kind.to_string() });
        }
        w.seen.insert(canonical.clone(), now);
    }
    out
}

pub struct WatchHub {
    watched: Arc<Mutex<Watched>>,
    watcher: Mutex<Option<RecommendedWatcher>>,
    sink: Arc<dyn Fn(FileChanged) + Send + Sync>,
    /// Cleared on drop so the poller thread ends with the hub.
    alive: Arc<AtomicBool>,
}

impl Drop for WatchHub {
    fn drop(&mut self) {
        self.alive.store(false, Ordering::Relaxed);
    }
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
        let watched = Arc::new(Mutex::new(Watched::new()));
        let sink: Arc<dyn Fn(FileChanged) + Send + Sync> = Arc::new(sink);
        let alive = Arc::new(AtomicBool::new(true));
        {
            let (watched, sink, alive) = (Arc::clone(&watched), Arc::clone(&sink), Arc::clone(&alive));
            let _ = std::thread::Builder::new().name("quikleaf-watch-poll".into()).spawn(move || {
                while alive.load(Ordering::Relaxed) {
                    std::thread::sleep(POLL_INTERVAL);
                    let hits = match watched.lock() {
                        Ok(mut w) => poll_once(&mut w),
                        Err(_) => Vec::new(),
                    };
                    for hit in hits {
                        sink(hit);
                    }
                }
            });
        }
        WatchHub { watched, watcher: Mutex::new(None), sink, alive }
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
                            Ok(mut w) => {
                                let hits = classify(&w.files, &event);
                                for p in &event.paths {
                                    let c = p.canonicalize().unwrap_or_else(|_| p.clone());
                                    w.refresh(&c);
                                }
                                hits
                            }
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
        w.seen.insert(canonical.clone(), stamp(&canonical));
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
        w.seen.remove(&canonical);
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

    fn watched_one(file: &Path, given: &str) -> Watched {
        let mut w = Watched::new();
        let canonical = file.canonicalize().unwrap();
        w.files.insert(canonical.clone(), given.to_string());
        w.seen.insert(canonical, stamp(file));
        w
    }

    #[test]
    fn poll_once_reports_a_changed_size_once_then_removal_then_return() {
        let tmp = TempDir::new().unwrap();
        let file = tmp.path().join("a.md");
        std::fs::write(&file, "one").unwrap();
        let mut w = watched_one(&file, "/as/given/a.md");

        assert!(poll_once(&mut w).is_empty(), "nothing changed yet");
        std::fs::write(&file, "one two").unwrap();
        let hits = poll_once(&mut w);
        assert_eq!(hits.len(), 1);
        assert_eq!((hits[0].path.as_str(), hits[0].kind.as_str()), ("/as/given/a.md", "changed"));
        assert!(poll_once(&mut w).is_empty(), "reported once");

        std::fs::remove_file(&file).unwrap();
        assert_eq!(poll_once(&mut w)[0].kind, "removed");
        assert!(poll_once(&mut w).is_empty(), "removal reported once");
        std::fs::write(&file, "back").unwrap();
        assert_eq!(poll_once(&mut w)[0].kind, "changed");
    }

    #[test]
    fn refresh_moves_the_baseline_so_an_os_event_is_not_reported_again() {
        let tmp = TempDir::new().unwrap();
        let file = tmp.path().join("a.md");
        std::fs::write(&file, "one").unwrap();
        let mut w = watched_one(&file, "/as/given/a.md");
        std::fs::write(&file, "one two three").unwrap();
        w.refresh(&file.canonicalize().unwrap());
        assert!(poll_once(&mut w).is_empty());
        // Paths that are not watched are ignored by refresh.
        w.refresh(&tmp.path().join("other.md"));
        assert_eq!(w.seen.len(), 1);
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
