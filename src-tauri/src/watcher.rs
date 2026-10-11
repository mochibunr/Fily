//! Watches the folders the panes are showing and tells the front end when the
//! contents change underneath it.
//!
//! Fily's own operations already call `refreshAll` when they finish, so this is
//! only about changes made *outside* the app: a file dropped in by a download,
//! an archive unpacked from a terminal, an editor's atomic save. Without it the
//! listing silently disagrees with the disk until you hit refresh.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter, Manager};

/// Event the front end listens for. The payload is the directory that moved,
/// so it can skip panes showing something else.
pub const FS_CHANGED: &str = "fs-changed";

/// The live watcher plus the paths it is currently watching.
///
/// `notify` only keeps delivering while the watcher is alive, so it is held in
/// Tauri state rather than in the callback's closure.
#[derive(Default)]
pub struct WatcherState(pub Mutex<Option<Active>>);

pub struct Active {
    pub(crate) watcher: RecommendedWatcher,
    pub(crate) watched: Vec<PathBuf>,
}

/// Point the watcher at exactly the directories the panes are showing.
///
/// The set is replaced rather than added to: a pane that navigated away must
/// stop reporting, and unbounded accumulation would leave inotify handles open
/// on folders nobody is looking at.
#[tauri::command]
pub fn watch_panes(app: AppHandle, paths: Vec<String>) -> Result<(), String> {
    let state = app.state::<WatcherState>();
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "watcher lock poisoned".to_string())?;

    // Unwatch before dropping, so a plain re-navigate (the same path arriving
    // again after a refresh) costs no new handles. Dropping the watcher would
    // release them all anyway, but doing it explicitly keeps the inotify watch
    // count from climbing if this ever grows into an incremental update.
    if let Some(active) = guard.as_mut() {
        for p in active.watched.drain(..) {
            let _ = active.watcher.unwatch(&p);
        }
    }
    *guard = None;

    let unique = watch_targets(&paths);
    if unique.is_empty() {
        return Ok(());
    }

    let emit = app.clone();
    // Events arrive on notify's own thread. Errors are dropped rather than
    // propagated: a vanished directory is normal while the user navigates.
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
        let Ok(ev) = res else { return };
        // Access events are reads (opening a file, stat calls the watcher makes
        // itself). Refreshing on those would re-list forever without the
        // listing changing.
        if ev.kind.is_access() {
            return;
        }
        // The event names the file that changed; the pane cares about its own
        // directory, so take the parent.
        let dir = ev
            .paths
            .first()
            .and_then(|p| p.parent().map(Path::to_path_buf))
            .unwrap_or_default();
        let _ = emit.emit(FS_CHANGED, dir.to_string_lossy().to_string());
    })
    .map_err(|e| format!("cannot watch folders: {e}"))?;

    for p in &unique {
        // Non-recursive: a pane shows one folder. Watching the whole tree of a
        // large directory would cost a handle per subdirectory for listings the
        // user never sees.
        if let Err(e) = watcher.watch(p, RecursiveMode::NonRecursive) {
            eprintln!("fily: cannot watch {}: {e}", p.display());
        }
    }

    *guard = Some(Active {
        watcher,
        watched: unique,
    });
    Ok(())
}

/// Testable core: which of `paths` are directories worth watching, canonicalised
/// and de-duplicated. Split out so the filtering can be tested without a live
/// watcher.
pub fn watch_targets(paths: &[String]) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    for raw in paths {
        let p = Path::new(raw);
        if !p.is_dir() {
            continue;
        }
        let canon = p.canonicalize().unwrap_or_else(|_| p.to_path_buf());
        if !out.contains(&canon) {
            out.push(canon);
        }
    }
    out
}

/// Reported back so the front end can show what is being watched. Not a
/// control surface -- purely diagnostic.
#[tauri::command]
pub fn watched_paths(app: AppHandle) -> Vec<String> {
    let state = app.state::<WatcherState>();
    let Ok(guard) = state.0.lock() else {
        return vec![];
    };
    match guard.as_ref() {
        Some(a) => a
            .watched
            .iter()
            .map(|p| p.to_string_lossy().to_string())
            .collect(),
        None => vec![],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn td(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("fily-watch-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn only_real_directories_are_watched() {
        let dir = td("real");
        let file = dir.join("a.txt");
        std::fs::write(&file, b"x").unwrap();
        let missing = dir.join("nope");

        let got = watch_targets(&[
            dir.to_string_lossy().into_owned(),
            file.to_string_lossy().into_owned(),
            missing.to_string_lossy().into_owned(),
        ]);
        assert_eq!(
            got.len(),
            1,
            "only the directory should be watched: {got:?}"
        );
        assert_eq!(got[0], dir.canonicalize().unwrap());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn duplicate_and_alias_paths_collapse_to_one_watch() {
        // Two panes can show the same folder, and one may reach it through a
        // symlink. notify rejects a second watch on the same path, so these
        // must collapse.
        let dir = td("dupe");
        let link = dir
            .parent()
            .unwrap()
            .join(format!("fily-watch-link-{}", std::process::id()));
        let _ = std::fs::remove_file(&link);
        std::os::unix::fs::symlink(&dir, &link).unwrap();

        let got = watch_targets(&[
            dir.to_string_lossy().into_owned(),
            dir.to_string_lossy().into_owned(),
            link.to_string_lossy().into_owned(),
        ]);
        assert_eq!(got.len(), 1, "expected one watch, got {got:?}");
        let _ = std::fs::remove_file(&link);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_new_file_raises_an_event() {
        use std::sync::{Arc, Mutex as M};
        let dir = td("live");
        let seen = Arc::new(M::new(Vec::<String>::new()));
        let sink = seen.clone();
        let mut w = notify::recommended_watcher(move |res: notify::Result<Event>| {
            if let Ok(ev) = res {
                if !ev.kind.is_access() {
                    sink.lock().unwrap().push(format!("{:?}", ev.kind));
                }
            }
        })
        .unwrap();
        w.watch(&dir, RecursiveMode::NonRecursive).unwrap();

        std::fs::write(dir.join("fresh.txt"), b"new").unwrap();
        // inotify is asynchronous; give the thread a moment to deliver.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while seen.lock().unwrap().is_empty() && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        assert!(
            !seen.lock().unwrap().is_empty(),
            "creating a file in a watched directory must raise an event"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
