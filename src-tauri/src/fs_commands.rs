//! Centralized filesystem operations for Fily.
//!
//! Safety rules enforced here:
//! - Paths must be non-empty, contain no NUL bytes, and be absolute.
//! - No shell-string construction anywhere; terminal opening uses argv arrays.
//! - Listing uses `symlink_metadata` so symlinks are never followed implicitly.
//! - Copy/move never silently overwrite: conflicts are reported unless the
//!   caller explicitly passes `overwrite: true` or `keep_both: true`.
//! - Permanent deletion refuses `/`, home roots and other dangerous targets.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::logic;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub is_hidden: bool,
    pub size: u64,
    pub modified: Option<i64>,
    pub created: Option<i64>,
    pub extension: String,
    pub mime: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpFailure {
    pub path: String,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpResult {
    pub ok: bool,
    pub failures: Vec<OpFailure>,
    pub conflicts: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyOptions {
    pub overwrite: Option<bool>,
    pub keep_both: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchOptions {
    pub query: String,
    pub recursive: bool,
    pub extensions: Vec<String>,
    pub min_size: Option<u64>,
    pub max_size: Option<u64>,
    pub modified_after: Option<i64>,
    pub modified_before: Option<i64>,
    pub max_results: Option<usize>,
    pub max_depth: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Place {
    pub id: String,
    pub label: String,
    pub path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Volume {
    pub label: String,
    pub path: String,
    pub total: Option<u64>,
    pub available: Option<u64>,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

pub(crate) fn err<T>(msg: impl Into<String>) -> Result<T, String> {
    Err(msg.into())
}
/// Validate a user-supplied path: absolute, no NUL bytes, non-empty.
pub(crate) fn valid_path(raw: &str) -> Result<PathBuf, String> {
    if raw.is_empty() {
        return err("Empty path");
    }
    if raw.contains('\0') {
        return err("Invalid path (NUL byte)");
    }
    let p = PathBuf::from(raw);
    if !p.is_absolute() {
        return err(format!("Path must be absolute: {raw}"));
    }
    Ok(p)
}

fn ms(t: SystemTime) -> Option<i64> {
    t.duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|d| i64::try_from(d.as_millis()).ok())
}

fn entry_from_path(path: &Path, meta: &fs::Metadata) -> FileEntry {
    let name = path
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string_lossy().into_owned());
    // Every caller passes `fs::symlink_metadata`, so the file type — symlink
    // included — is already in hand. This used to stat the path a second time
    // for every single entry, doubling the syscalls in a full directory walk.
    let is_symlink = meta.file_type().is_symlink();
    let ft = meta.file_type();
    let is_dir = ft.is_dir() && !is_symlink;
    let extension = path
        .extension()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let mime = mime_guess::from_path(path)
        .first_or_octet_stream()
        .to_string();
    FileEntry {
        name: name.clone(),
        path: path.to_string_lossy().into_owned(),
        is_dir,
        is_symlink,
        is_hidden: name.starts_with('.'),
        size: if meta.is_dir() { 0 } else { meta.len() },
        modified: meta.modified().ok().and_then(ms),
        created: meta.created().ok().and_then(ms),
        extension,
        mime,
    }
}

/// Refuse to permanently delete filesystem roots and home directories.
fn is_protected_target(p: &Path) -> bool {
    let home = dirs::home_dir()
        .map(|h| h.to_string_lossy().into_owned())
        .unwrap_or_default();
    logic::is_protected(&p.to_string_lossy(), &home)
}

/// Copy a single file or dir tree. Used for copy and cross-device move.
fn copy_tree(src: &Path, dest: &Path) -> std::io::Result<()> {
    let meta = fs::symlink_metadata(src)?;
    if meta.file_type().is_symlink() {
        let target = fs::read_link(src)?;
        #[cfg(unix)]
        std::os::unix::fs::symlink(&target, dest)?;
        #[cfg(windows)]
        {
            if target.is_dir() {
                std::os::windows::fs::symlink_dir(&target, dest)?;
            } else {
                std::os::windows::fs::symlink_file(&target, dest)?;
            }
        }
        return Ok(());
    }
    if meta.is_dir() {
        fs::create_dir_all(dest)?;
        for item in fs::read_dir(src)? {
            let item = item?;
            copy_tree(&item.path(), &dest.join(item.file_name()))?;
        }
        return Ok(());
    }
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::copy(src, dest)?;
    Ok(())
}

/// Destination with "keep both" naming: `name (2).ext`, `name (3).ext`, …
fn keep_both_path(dest: &Path) -> PathBuf {
    if !dest.exists() {
        return dest.to_path_buf();
    }
    let parent = dest.parent().unwrap_or(Path::new("/")).to_path_buf();
    let file_name = dest
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let fresh = logic::keep_both_name(&file_name, |n| parent.join(n).exists());
    parent.join(fresh)
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Run a blocking command on a worker thread instead of the UI thread.
///
/// A plain `#[tauri::command] fn` is invoked *inline* on the IPC thread (see
/// tauri's `body_blocking` codegen), so a slow walk, hash or copy froze the
/// whole window. Declaring the command `async` only moves it onto the async
/// runtime, which is still shared work; wrapping the body in `spawn_blocking`
/// hands it to a dedicated blocking thread and keeps the UI responsive.
pub(crate) fn offload<T, F>(
    what: &'static str,
    f: F,
) -> impl std::future::Future<Output = Result<T, String>>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    async move {
        tauri::async_runtime::spawn_blocking(f)
            .await
            .map_err(|e| format!("{what} failed: {e}"))?
    }
}

#[tauri::command]
pub async fn list_dir(path: String, show_hidden: bool) -> Result<Vec<FileEntry>, String> {
    offload("Listing", move || list_dir_blocking(path, show_hidden)).await
}

fn list_dir_blocking(path: String, show_hidden: bool) -> Result<Vec<FileEntry>, String> {
    let dir = valid_path(&path)?;
    let meta = fs::symlink_metadata(&dir)
        .map_err(|e| format!("Cannot access '{}': {e}", dir.display()))?;
    if !meta.file_type().is_dir() {
        return err(format!("Not a directory: {}", dir.display()));
    }
    let read = fs::read_dir(&dir).map_err(|e| format!("Cannot list '{}': {e}", dir.display()))?;
    let mut out = Vec::new();
    for item in read {
        let item = match item {
            Ok(i) => i,
            Err(_) => continue, // skip unreadable entries, keep listing
        };
        let p = item.path();
        let name = item.file_name().to_string_lossy().into_owned();
        if !show_hidden && name.starts_with('.') {
            continue;
        }
        match fs::symlink_metadata(&p) {
            Ok(m) => out.push(entry_from_path(&p, &m)),
            Err(_) => continue,
        }
    }
    // Directories first, then case-insensitive name order.
    out.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(out)
}

#[tauri::command]
pub fn stat_path(path: String) -> Result<FileEntry, String> {
    let p = valid_path(&path)?;
    let meta =
        fs::symlink_metadata(&p).map_err(|e| format!("Cannot stat '{}': {e}", p.display()))?;
    Ok(entry_from_path(&p, &meta))
}

#[tauri::command]
pub fn create_dir(parent: String, name: String) -> Result<String, String> {
    if !logic::is_valid_entry_name(&name) {
        return err("Invalid folder name");
    }
    let parent = valid_path(&parent)?;
    let target = parent.join(&name);
    if target.exists() {
        return err(format!("'{}' already exists", name));
    }
    fs::create_dir(&target).map_err(|e| format!("Cannot create folder: {e}"))?;
    Ok(target.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn create_file(parent: String, name: String) -> Result<String, String> {
    if !logic::is_valid_entry_name(&name) {
        return err("Invalid file name");
    }
    let parent = valid_path(&parent)?;
    let target = parent.join(&name);
    if target.exists() {
        return err(format!("'{}' already exists", name));
    }
    fs::write(&target, []).map_err(|e| format!("Cannot create file: {e}"))?;
    Ok(target.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn rename_path(path: String, new_name: String) -> Result<String, String> {
    if !logic::is_valid_entry_name(&new_name) {
        return err("Invalid name");
    }
    let src = valid_path(&path)?;
    if !src.exists() && fs::symlink_metadata(&src).is_err() {
        return err("File no longer exists");
    }
    let parent = src
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "Cannot rename filesystem root".to_string())?;
    let dest = parent.join(&new_name);
    if dest == src {
        return Ok(src.to_string_lossy().into_owned());
    }
    if dest.exists() {
        return err(format!("'{}' already exists", new_name));
    }
    fs::rename(&src, &dest).map_err(|e| format!("Cannot rename: {e}"))?;
    Ok(dest.to_string_lossy().into_owned())
}

fn resolve_dest(dest_dir: &Path, src: &Path, opts: &CopyOptions) -> Result<PathBuf, String> {
    let name = src
        .file_name()
        .ok_or_else(|| "Cannot determine file name".to_string())?;
    let mut dest = dest_dir.join(name);
    if dest.exists() || fs::symlink_metadata(&dest).is_ok() {
        if opts.keep_both.unwrap_or(false) {
            dest = keep_both_path(&dest);
        } else if !opts.overwrite.unwrap_or(false) {
            return Err(format!("CONFLICT:{}", dest.to_string_lossy()));
        }
    }
    Ok(dest)
}

#[tauri::command]
pub async fn copy_paths(
    sources: Vec<String>,
    dest_dir: String,
    options: Option<CopyOptions>,
) -> Result<OpResult, String> {
    offload("Copy", move || {
        copy_paths_blocking(sources, dest_dir, options)
    })
    .await
}

fn copy_paths_blocking(
    sources: Vec<String>,
    dest_dir: String,
    options: Option<CopyOptions>,
) -> Result<OpResult, String> {
    let dest_dir = valid_path(&dest_dir)?;
    if !dest_dir.is_dir() {
        return err("Destination is not a folder");
    }
    let opts = options.unwrap_or(CopyOptions {
        overwrite: Some(false),
        keep_both: Some(false),
    });
    // Pre-flight: collect conflicts so the UI can ask once.
    if !opts.overwrite.unwrap_or(false) && !opts.keep_both.unwrap_or(false) {
        let conflicts: Vec<String> = sources
            .iter()
            .filter_map(|s| {
                let name = Path::new(s).file_name()?.to_string_lossy().into_owned();
                let d = dest_dir.join(&name);
                (d.exists() || fs::symlink_metadata(&d).is_ok())
                    .then(|| d.to_string_lossy().into_owned())
            })
            .collect();
        if !conflicts.is_empty() {
            return Ok(OpResult {
                ok: false,
                failures: vec![],
                conflicts,
            });
        }
    }
    let mut result = OpResult {
        ok: true,
        failures: vec![],
        conflicts: vec![],
    };
    for raw in &sources {
        let src = match valid_path(raw) {
            Ok(p) => p,
            Err(e) => {
                result.ok = false;
                result.failures.push(OpFailure {
                    path: raw.clone(),
                    message: e,
                });
                continue;
            }
        };
        // Refuse to copy a directory into itself.
        if dest_dir.starts_with(&src)
            && fs::symlink_metadata(&src)
                .map(|m| m.is_dir())
                .unwrap_or(false)
        {
            result.ok = false;
            result.failures.push(OpFailure {
                path: raw.clone(),
                message: "Cannot copy a folder into itself".into(),
            });
            continue;
        }
        let dest = match resolve_dest(&dest_dir, &src, &opts) {
            Ok(d) => d,
            Err(e) => {
                result.ok = false;
                let msg = e.strip_prefix("CONFLICT:").unwrap_or(&e).to_string();
                result.failures.push(OpFailure {
                    path: raw.clone(),
                    message: format!("Already exists: {msg}"),
                });
                continue;
            }
        };
        if dest.exists() || fs::symlink_metadata(&dest).is_ok() {
            let _ = fs::remove_file(&dest).or_else(|_| fs::remove_dir_all(&dest));
        }
        if let Err(e) = copy_tree(&src, &dest) {
            result.ok = false;
            result.failures.push(OpFailure {
                path: raw.clone(),
                message: e.to_string(),
            });
        }
    }
    Ok(result)
}

#[tauri::command]
pub async fn move_paths(
    sources: Vec<String>,
    dest_dir: String,
    options: Option<CopyOptions>,
) -> Result<OpResult, String> {
    offload("Move", move || {
        move_paths_blocking(sources, dest_dir, options)
    })
    .await
}

fn move_paths_blocking(
    sources: Vec<String>,
    dest_dir: String,
    options: Option<CopyOptions>,
) -> Result<OpResult, String> {
    let dest_dir = valid_path(&dest_dir)?;
    if !dest_dir.is_dir() {
        return err("Destination is not a folder");
    }
    let opts = options.unwrap_or(CopyOptions {
        overwrite: Some(false),
        keep_both: Some(false),
    });
    if !opts.overwrite.unwrap_or(false) && !opts.keep_both.unwrap_or(false) {
        let conflicts: Vec<String> = sources
            .iter()
            .filter_map(|s| {
                let name = Path::new(s).file_name()?.to_string_lossy().into_owned();
                let d = dest_dir.join(&name);
                (d.exists() || fs::symlink_metadata(&d).is_ok())
                    .then(|| d.to_string_lossy().into_owned())
            })
            .collect();
        if !conflicts.is_empty() {
            return Ok(OpResult {
                ok: false,
                failures: vec![],
                conflicts,
            });
        }
    }
    let mut result = OpResult {
        ok: true,
        failures: vec![],
        conflicts: vec![],
    };
    for raw in &sources {
        let src = match valid_path(raw) {
            Ok(p) => p,
            Err(e) => {
                result.ok = false;
                result.failures.push(OpFailure {
                    path: raw.clone(),
                    message: e,
                });
                continue;
            }
        };
        if dest_dir.starts_with(&src) {
            result.ok = false;
            result.failures.push(OpFailure {
                path: raw.clone(),
                message: "Cannot move a folder into itself".into(),
            });
            continue;
        }
        let dest = match resolve_dest(&dest_dir, &src, &opts) {
            Ok(d) => d,
            Err(e) => {
                result.ok = false;
                let msg = e.strip_prefix("CONFLICT:").unwrap_or(&e).to_string();
                result.failures.push(OpFailure {
                    path: raw.clone(),
                    message: format!("Already exists: {msg}"),
                });
                continue;
            }
        };
        if dest.exists() || fs::symlink_metadata(&dest).is_ok() {
            let _ = fs::remove_file(&dest).or_else(|_| fs::remove_dir_all(&dest));
        }
        // Fast path: same-filesystem rename. Fall back to copy + delete.
        match fs::rename(&src, &dest) {
            Ok(()) => {}
            Err(_) => match copy_tree(&src, &dest) {
                Ok(()) => {
                    let cleanup = fs::remove_file(&src).or_else(|_| fs::remove_dir_all(&src));
                    if let Err(e) = cleanup {
                        result.ok = false;
                        result.failures.push(OpFailure {
                            path: raw.clone(),
                            message: format!("Moved but could not remove source: {e}"),
                        });
                    }
                }
                Err(e) => {
                    result.ok = false;
                    result.failures.push(OpFailure {
                        path: raw.clone(),
                        message: e.to_string(),
                    });
                }
            },
        }
    }
    Ok(result)
}

#[tauri::command]
pub async fn duplicate_path(path: String) -> Result<String, String> {
    offload("Duplicate", move || duplicate_path_blocking(path)).await
}

fn duplicate_path_blocking(path: String) -> Result<String, String> {
    let src = valid_path(&path)?;
    let parent = src
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "Cannot duplicate filesystem root".to_string())?;
    let dest = keep_both_path(&parent.join(src.file_name().ok_or("Invalid path")?));
    copy_tree(&src, &dest).map_err(|e| format!("Cannot duplicate: {e}"))?;
    Ok(dest.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn trash_paths(paths: Vec<String>) -> Result<OpResult, String> {
    offload("Move to Trash", move || trash_paths_blocking(paths)).await
}

fn trash_paths_blocking(paths: Vec<String>) -> Result<OpResult, String> {
    let mut result = OpResult {
        ok: true,
        failures: vec![],
        conflicts: vec![],
    };
    for raw in &paths {
        let p = match valid_path(raw) {
            Ok(p) => p,
            Err(e) => {
                result.ok = false;
                result.failures.push(OpFailure {
                    path: raw.clone(),
                    message: e,
                });
                continue;
            }
        };
        if is_protected_target(&p) {
            result.ok = false;
            result.failures.push(OpFailure {
                path: raw.clone(),
                message: "Refusing to trash a system location".into(),
            });
            continue;
        }
        if let Err(e) = trash::delete(&p) {
            result.ok = false;
            result.failures.push(OpFailure {
                path: raw.clone(),
                message: e.to_string(),
            });
        }
    }
    Ok(result)
}

#[tauri::command]
pub async fn delete_permanent(paths: Vec<String>) -> Result<OpResult, String> {
    offload("Delete", move || delete_permanent_blocking(paths)).await
}

fn delete_permanent_blocking(paths: Vec<String>) -> Result<OpResult, String> {
    let mut result = OpResult {
        ok: true,
        failures: vec![],
        conflicts: vec![],
    };
    for raw in &paths {
        let p = match valid_path(raw) {
            Ok(p) => p,
            Err(e) => {
                result.ok = false;
                result.failures.push(OpFailure {
                    path: raw.clone(),
                    message: e,
                });
                continue;
            }
        };
        if is_protected_target(&p) {
            result.ok = false;
            result.failures.push(OpFailure {
                path: raw.clone(),
                message: "Refusing to permanently delete a system location".into(),
            });
            continue;
        }
        let r = fs::symlink_metadata(&p).map(|m| {
            if m.file_type().is_symlink() || m.is_file() {
                fs::remove_file(&p)
            } else {
                fs::remove_dir_all(&p)
            }
        });
        match r {
            Ok(Ok(())) => {}
            Ok(Err(e)) | Err(e) => {
                result.ok = false;
                result.failures.push(OpFailure {
                    path: raw.clone(),
                    message: e.to_string(),
                });
            }
        }
    }
    Ok(result)
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/// Directory names that are never worth searching: caches, SDK checkouts, VCS
/// internals and dependency trees. Matched exactly (case-insensitively) rather
/// than by substring, so a project legitimately called `git` is not pruned.
///
/// `Android` and `Flutter` are the usual bare SDK checkouts in `$HOME`; both
/// hold hundreds of thousands of files. Matching them case-insensitively also
/// prunes a lowercase project folder of the same name, which is the
/// deliberate trade — the SDK copy is far more expensive to walk.
const NOISE_DIRS: [&str; 16] = [
    "cache",
    ".cache",
    "node_modules",
    "thumbnails",
    ".thumbnails",
    "Trash",
    ".Trash",
    "trash",
    ".git",
    "snap",
    ".gradle",
    ".codex",
    ".rustup",
    ".pub-cache",
    "Android",
    "Flutter",
];

/// Absolute prefixes that are noise regardless of what they are called.
const NOISE_PREFIXES: [&str; 5] = ["/tmp", "/proc", "/sys", "/dev", "/run"];

/// True when `path` is a subtree the walker should not descend into.
///
/// `root` matters: the search root must never be pruned (searching inside
/// `/tmp` is legitimate), and a noise-prefix rule must not fire when the whole
/// search is already contained in that prefix.
fn is_search_noise(path: &Path, root: &Path) -> bool {
    if path == root {
        return false;
    }
    let s = path.to_string_lossy();
    let root_s = root.to_string_lossy();
    // Only prune by absolute prefix when the search itself is not under it.
    if NOISE_PREFIXES.iter().any(|p| s.starts_with(p))
        && !NOISE_PREFIXES.iter().any(|p| root_s.starts_with(p))
    {
        return true;
    }
    // Only the entry's own name can matter. A noise directory is pruned before the
    // walk queues it, so nothing underneath one is ever visited — testing every
    // path component (which also allocated a PathBuf per entry) could not
    // change the answer, and this runs for every entry in the tree.
    path.file_name()
        .and_then(|n| n.to_str())
        .map(|n| NOISE_DIRS.iter().any(|d| n.eq_ignore_ascii_case(d)))
        .unwrap_or(false)
}

/// Decide whether a walked entry matches, from primitives rather than from a
/// built `FileEntry`.
///
/// This matters for speed: `entry_from_path` runs `mime_guess` and allocates
/// several strings per entry, and a home-folder search can stat hundreds of
/// thousands of entries of which only a few dozen match. Deciding first and
/// building only the winners keeps the walk from allocating for entries nobody
/// will ever see. Each optional filter's inputs are computed lazily for the
/// same reason — no filter means no `modified()` call, no extension, no work.
fn matches_search(
    name: &str,
    path: &Path,
    meta: &fs::Metadata,
    is_dir: bool,
    opts: &SearchOptions,
    q: &str,
) -> bool {
    if !logic::name_matches(name, q) {
        return false;
    }
    // Directories carry no extension, so an extension filter can never match
    // one. Applying the filter to them as-is silently dropped every folder
    // from results, which made searching for a folder look like a dead end
    // whenever any filter text was present. Folders are containers, not typed
    // files: the name test above already decided whether they match.
    if !opts.extensions.is_empty() && !is_dir {
        let ext = path
            .extension()
            .map(|s| s.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        if !opts
            .extensions
            .iter()
            .any(|e| e.trim_start_matches('.').to_lowercase() == ext)
        {
            return false;
        }
    }
    if let Some(min) = opts.min_size {
        if !is_dir && meta.len() < min {
            return false;
        }
    }
    if let Some(max) = opts.max_size {
        if !is_dir && meta.len() > max {
            return false;
        }
    }
    // Only pay for the timestamp when a date filter is actually in play.
    if opts.modified_after.is_some() || opts.modified_before.is_some() {
        let modified = meta.modified().ok().and_then(ms);
        if let Some(after) = opts.modified_after {
            if modified.map(|m| m < after).unwrap_or(true) {
                return false;
            }
        }
        if let Some(before) = opts.modified_before {
            if modified.map(|m| m > before).unwrap_or(true) {
                return false;
            }
        }
    }
    true
}

#[tauri::command]
pub async fn search_dir(dir: String, options: SearchOptions) -> Result<Vec<FileEntry>, String> {
    offload("Search", move || search_dir_blocking(dir, options)).await
}

fn search_dir_blocking(dir: String, options: SearchOptions) -> Result<Vec<FileEntry>, String> {
    let root = valid_path(&dir)?;
    if !root.is_dir() {
        return err("Not a directory");
    }
    // Supersede token: every new search bumps the generation; an older run
    // that is still walking notices within ~1024 entries and stops early
    // instead of burning CPU/IO on results nobody will read.
    static GENERATION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let gen = GENERATION.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
    // Clamp an absurdly long query — pasting an essay into a filename box
    // must not change matching behavior or cost.
    let raw_q = options.query.chars().take(200).collect::<String>();
    let q = raw_q.to_lowercase();
    let max_results = options.max_results.unwrap_or(500).min(5000);
    let max_depth = options
        .max_depth
        .unwrap_or(if options.recursive { 8 } else { 1 });
    let depth = if options.recursive { max_depth } else { 1 };
    // Breadth-first, level by level, via an explicit queue.
    //
    // A plain WalkDir recursion is depth-first, so it commits to one subtree
    // before ever listing the next sibling's children. In a home folder that
    // means the walk dives into the first large tree it meets and can spend
    // the entire visit budget down there, never coming back up to look at the
    // folders sitting right beside it -- so searching for a top-level folder
    // could return nothing at all. Visiting every level shallowest-first means
    // the budget is always spent on the entries closest to where the user is
    // standing, which is what they are almost always looking for.
    let mut out = Vec::new();
    let mut visited = 0usize;
    let mut queue: std::collections::VecDeque<(std::path::PathBuf, usize)> =
        std::collections::VecDeque::new();
    queue.push_back((root.clone(), 0));

    'walk: while let Some((dir_path, dir_depth)) = queue.pop_front() {
        if out.len() >= max_results {
            break;
        }
        let reader = match fs::read_dir(&dir_path) {
            Ok(r) => r,
            // Unreadable directory: skip it, as walkdir's filter_map did.
            Err(_) => continue,
        };
        // Children are queued behind every sibling directory's own entries so
        // the next level stays level-ordered rather than depth-ordered.
        let mut children: Vec<std::path::PathBuf> = Vec::new();
        for item in reader.filter_map(|e| e.ok()) {
            if out.len() >= max_results {
                break 'walk;
            }
            visited += 1;
            if visited % 1024 == 0 {
                // Superseded by a newer search, or past a sane walk budget:
                // stop early and return what we have.
                if GENERATION.load(std::sync::atomic::Ordering::SeqCst) != gen || visited > 300_000
                {
                    break 'walk;
                }
            }
            let p = item.path();
            if p == root {
                continue;
            }
            if is_search_noise(&p, &root) {
                continue;
            }
            // `read_dir` already carries each entry's file type in the dirent
            // on Linux, so this costs no syscall in the normal case. Getting
            // it from here rather than from a fresh `symlink_metadata` is what
            // removes the per-entry stat: a home-folder walk can touch
            // hundreds of thousands of entries, and only the handful that
            // actually match ever needed the rest of the metadata.
            let ft = match item.file_type() {
                Ok(f) => f,
                Err(_) => continue,
            };
            let is_dir = ft.is_dir();

            let raw_name = item.file_name();
            let name_cow = raw_name.to_string_lossy();
            let name = name_cow.as_ref();

            // Reject on the name alone before doing any real work. Stat, mime
            // guessing and entry construction are only reached for entries
            // that can still match, or when a filter needs metadata that the
            // dirent does not carry.
            let name_hit = logic::name_matches(name, &q);
            let filters_need_meta = !options.extensions.is_empty()
                || options.min_size.is_some()
                || options.max_size.is_some()
                || options.modified_after.is_some()
                || options.modified_before.is_some();
            if name_hit || filters_need_meta {
                let meta = match fs::symlink_metadata(&p) {
                    Ok(m) => m,
                    Err(_) => continue,
                };
                if matches_search(name, &p, &meta, is_dir, &options, &q) {
                    out.push(Hit {
                        depth: dir_depth + 1,
                        entry: entry_from_path(&p, &meta),
                    });
                }
            }
            // symlink_metadata reports a symlink as a non-directory, so
            // linked trees are not followed -- same as follow_links(false).
            if is_dir && dir_depth + 1 < depth {
                children.push(p);
            }
        }
        for child in children {
            queue.push_back((child, dir_depth + 1));
        }
    }
    // Closest first, then folders before files, then by name.
    //
    // Depth is the point of the breadth-first walk above: results sitting in
    // the folder you searched come before identically-named ones buried in
    // Downloads or Documents, which is almost always the one you meant. The
    // final sort would otherwise throw that ordering away and alphabetise the
    // whole result set flat.
    out.sort_by(|a, b| {
        a.depth
            .cmp(&b.depth)
            .then_with(|| b.entry.is_dir.cmp(&a.entry.is_dir))
            .then_with(|| {
                a.entry
                    .name
                    .to_lowercase()
                    .cmp(&b.entry.name.to_lowercase())
            })
    });
    Ok(out.into_iter().map(|h| h.entry).collect())
}

/// A search result plus how far below the search root it was found.
struct Hit {
    depth: usize,
    entry: FileEntry,
}

// ---------------------------------------------------------------------------
// Previews
// ---------------------------------------------------------------------------

const TEXT_PREVIEW_LIMIT: u64 = 256 * 1024;
const IMAGE_PREVIEW_LIMIT: u64 = 12 * 1024 * 1024;

#[tauri::command]
pub async fn read_text_preview(path: String) -> Result<serde_json::Value, String> {
    offload("Read preview", move || read_text_preview_blocking(path)).await
}

fn read_text_preview_blocking(path: String) -> Result<serde_json::Value, String> {
    let p = valid_path(&path)?;
    let meta = fs::symlink_metadata(&p).map_err(|e| format!("Cannot read: {e}"))?;
    if meta.is_dir() {
        return err("Cannot preview a directory as text");
    }
    if meta.len() > 4 * 1024 * 1024 {
        return err("File too large to preview");
    }
    let f = fs::File::open(&p).map_err(|e| format!("Cannot read: {e}"))?;
    let mut buf = Vec::new();
    f.take(TEXT_PREVIEW_LIMIT + 1)
        .read_to_end(&mut buf)
        .map_err(|e| format!("Cannot read: {e}"))?;
    let truncated = buf.len() as u64 > TEXT_PREVIEW_LIMIT;
    if truncated {
        buf.truncate(TEXT_PREVIEW_LIMIT as usize);
    }
    // Reject binary content: NUL byte in the first 8KB.
    let sample = &buf[..buf.len().min(8000)];
    if sample.contains(&0) {
        return err("Binary file — no text preview");
    }
    Ok(serde_json::json!({
        "truncated": truncated,
        "size": meta.len(),
        "text": String::from_utf8_lossy(&buf),
    }))
}

#[tauri::command]
pub async fn read_image_data_url(path: String) -> Result<String, String> {
    offload("Read image", move || read_image_data_url_blocking(path)).await
}

fn read_image_data_url_blocking(path: String) -> Result<String, String> {
    let p = valid_path(&path)?;
    let meta = fs::symlink_metadata(&p).map_err(|e| format!("Cannot read: {e}"))?;
    if meta.len() > IMAGE_PREVIEW_LIMIT {
        return err("Image too large to preview");
    }
    let bytes = fs::read(&p).map_err(|e| format!("Cannot read: {e}"))?;
    let mime = mime_guess::from_path(&p)
        .first_or_octet_stream()
        .to_string();
    Ok(format!(
        "data:{mime};base64,{}",
        base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes)
    ))
}

#[tauri::command]
pub fn list_archive(path: String) -> Result<Vec<String>, String> {
    let p = valid_path(&path)?;
    let f = fs::File::open(&p).map_err(|e| format!("Cannot open archive: {e}"))?;
    let mut zip =
        zip::ZipArchive::new(f).map_err(|e| format!("Unsupported or invalid archive: {e}"))?;
    let mut names = Vec::new();
    for i in 0..zip.len().min(500) {
        match zip.by_index(i) {
            Ok(entry) => names.push(entry.name().to_string()),
            Err(_) => continue,
        }
    }
    Ok(names)
}

/// Progress for a long-running operation, emitted as `op-progress` so the UI
/// can show a bar instead of an indefinite spinner. `finished` is sent once
/// at the end so the UI can drop the row without polling.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpProgress {
    pub id: String,
    pub label: String,
    pub current: String,
    pub done: u64,
    pub total: u64,
    pub finished: bool,
}

/// Emit `op-progress`, throttled by `step`, so a huge archive does not flood
/// the IPC channel with thousands of events.
pub(crate) fn report_progress(app: Option<&tauri::AppHandle>, p: &OpProgress, step: u64) {
    use tauri::Emitter;
    let Some(app) = app else { return };
    if !p.finished && p.done % step != 0 && p.done != p.total {
        return;
    }
    let _ = app.emit("op-progress", p);
}

#[tauri::command]
pub async fn extract_archive(
    app: tauri::AppHandle,
    path: String,
    dest_dir: String,
) -> Result<OpResult, String> {
    offload("Extract", move || {
        extract_archive_blocking(&app, path, dest_dir)
    })
    .await
}

fn extract_archive_blocking(
    app: &tauri::AppHandle,
    path: String,
    dest_dir: String,
) -> Result<OpResult, String> {
    let src = valid_path(&path)?;
    let dest = valid_path(&dest_dir)?;
    if !dest.is_dir() {
        return err("Destination is not a folder");
    }
    extract_to_any(&src, &dest, Some(app))
}

/// Shared extraction entry point: dispatches on the archive type so both
/// `extract_here` and `extract_archive` handle every supported format the
/// same way.
pub(crate) fn extract_to_any(
    src: &Path,
    dest: &Path,
    app: Option<&tauri::AppHandle>,
) -> Result<OpResult, String> {
    let name = src
        .file_name()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if !crate::archive_commands::is_extractable(&name) {
        return err(format!(
            "{name} is not an archive Fily can open. It handles zip, tar (also .gz, .bz2, .xz, .zst) and 7z."
        ));
    }
    use crate::archive_commands::Container;
    match crate::archive_commands::container_of(&name) {
        Container::Zip => extract_zip_to(src, dest, app),
        Container::SevenZ => crate::archive_commands::extract_7z_to(src, dest, app),
        Container::Rar => crate::archive_commands::extract_rar_to(src, dest),
        Container::Tar => crate::archive_commands::extract_tar_to(src, dest, app),
    }
}

/// Shared zip extraction with zip-slip protection. Both `extract_archive`
/// and `extract_here` go through this function.
pub(crate) fn extract_zip_to(
    src: &Path,
    dest: &Path,
    app: Option<&tauri::AppHandle>,
) -> Result<OpResult, String> {
    let f = fs::File::open(&src).map_err(|e| format!("Cannot open archive: {e}"))?;
    let archive_name = src
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "archive".into());
    let mut zip = zip::ZipArchive::new(f).map_err(|e| {
        // "Could not find EOCD" means the central directory is missing or
        // truncated. The usual causes are a partial download or a file that
        // simply is not a zip, and the bare zip-crate message says neither
        // which file nor what to do about it.
        format!(
            "{archive_name} is not a readable zip ({e}). It may be an incomplete download, or not a zip file at all."
        )
    })?;
    let total = zip.len() as u64;
    let id = format!("extract:{}", src.to_string_lossy());
    let label = format!("Extracting {archive_name}");
    // At most ~100 events regardless of archive size.
    let step = (total / 100).max(1);
    let mut result = OpResult {
        ok: true,
        failures: vec![],
        conflicts: vec![],
    };
    for i in 0..zip.len() {
        let mut entry = match zip.by_index(i) {
            Ok(e) => e,
            Err(e) => {
                result.ok = false;
                result.failures.push(OpFailure {
                    path: format!("#{i}"),
                    message: e.to_string(),
                });
                continue;
            }
        };
        let name = entry.name().to_string();
        // Progress before the work, so the bar moves as files land rather
        // than only at the end of a large archive.
        report_progress(
            app,
            &OpProgress {
                id: id.clone(),
                label: label.clone(),
                current: name.clone(),
                done: i as u64,
                total,
                finished: false,
            },
            step,
        );
        // Zip-slip protection: refuse absolute paths and `..` escapes.
        let rel = Path::new(&name);
        if rel.is_absolute()
            || rel
                .components()
                .any(|c| matches!(c, std::path::Component::ParentDir))
        {
            result.ok = false;
            result.failures.push(OpFailure {
                path: name,
                message: "Refused unsafe entry (path escape)".into(),
            });
            continue;
        }
        let target = dest.join(rel);
        if entry.is_dir() {
            if let Err(e) = fs::create_dir_all(&target) {
                result.ok = false;
                result.failures.push(OpFailure {
                    path: name,
                    message: e.to_string(),
                });
            }
            continue;
        }
        if let Some(parent) = target.parent() {
            if let Err(e) = fs::create_dir_all(parent) {
                result.ok = false;
                result.failures.push(OpFailure {
                    path: name.clone(),
                    message: e.to_string(),
                });
                continue;
            }
        }
        match fs::File::create(&target) {
            Ok(mut out) => {
                if let Err(e) = std::io::copy(&mut entry, &mut out) {
                    result.ok = false;
                    result.failures.push(OpFailure {
                        path: name,
                        message: e.to_string(),
                    });
                }
            }
            Err(e) => {
                result.ok = false;
                result.failures.push(OpFailure {
                    path: name,
                    message: e.to_string(),
                });
            }
        }
    }
    report_progress(
        app,
        &OpProgress {
            id,
            label,
            current: String::new(),
            done: total,
            total,
            finished: true,
        },
        1,
    );
    Ok(result)
}

// ---------------------------------------------------------------------------
// Info helpers
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn file_checksum(path: String, algo: String) -> Result<String, String> {
    offload("Checksum", move || file_checksum_blocking(path, algo)).await
}

fn file_checksum_blocking(path: String, algo: String) -> Result<String, String> {
    let p = valid_path(&path)?;
    let mut f = fs::File::open(&p).map_err(|e| format!("Cannot read: {e}"))?;
    if algo.to_lowercase() != "sha256" {
        return err("Only sha256 is supported");
    }
    use sha2::Digest;
    let mut hasher = sha2::Sha256::new();
    let mut buf = [0u8; 65536];
    loop {
        let n = f.read(&mut buf).map_err(|e| format!("Cannot read: {e}"))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex_encode(&hasher.finalize()))
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push(HEX[(b >> 4) as usize] as char);
        s.push(HEX[(b & 0xf) as usize] as char);
    }
    s
}

#[tauri::command]
pub async fn dir_size(path: String) -> Result<u64, String> {
    offload("Size scan", move || dir_size_blocking(path)).await
}

fn dir_size_blocking(path: String) -> Result<u64, String> {
    let root = valid_path(&path)?;
    let mut total = 0u64;
    for item in walkdir::WalkDir::new(&root)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
        .take(200_000)
    {
        if let Ok(m) = fs::symlink_metadata(item.path()) {
            if m.is_file() {
                total = total.saturating_add(m.len());
            }
        }
    }
    Ok(total)
}

// ---------------------------------------------------------------------------
// OS integration (no shell strings — argv arrays only)
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn open_path(path: String) -> Result<(), String> {
    let p = valid_path(&path)?;
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&p)
            .spawn()
            .map_err(|e| format!("Cannot open: {e}"))?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &p.to_string_lossy()])
            .spawn()
            .map_err(|e| format!("Cannot open: {e}"))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&p)
            .spawn()
            .map_err(|e| format!("Cannot open: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub fn open_terminal(path: String) -> Result<(), String> {
    let p = valid_path(&path)?;
    let dir = if p.is_dir() {
        p.clone()
    } else {
        p.parent().map(Path::to_path_buf).unwrap_or(p.clone())
    };
    #[cfg(target_os = "linux")]
    {
        for (bin, args) in [
            ("xdg-terminal-exec", Vec::<&str>::new()),
            ("kitty", Vec::<&str>::new()),
            ("gnome-terminal", Vec::<&str>::new()),
            ("konsole", Vec::<&str>::new()),
        ] {
            let mut cmd = std::process::Command::new(bin);
            cmd.current_dir(&dir);
            for a in &args {
                cmd.arg(a);
            }
            if cmd.spawn().is_ok() {
                return Ok(());
            }
        }
        // Last resort: xterm.
        std::process::Command::new("xterm")
            .current_dir(&dir)
            .spawn()
            .map_err(|e| format!("No terminal found: {e}"))?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", ""])
            .current_dir(&dir)
            .spawn()
            .map_err(|e| format!("Cannot open terminal: {e}"))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-a", "Terminal"])
            .arg(&dir)
            .spawn()
            .map_err(|e| format!("Cannot open terminal: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub fn get_places() -> Result<Vec<Place>, String> {
    let home = dirs::home_dir().ok_or_else(|| "No home directory".to_string())?;
    let h = |parts: &[&str]| -> String {
        let mut p = home.clone();
        for part in parts {
            p.push(part);
        }
        p.to_string_lossy().into_owned()
    };
    let candidates = [
        ("home", "Home", home.to_string_lossy().into_owned()),
        ("desktop", "Desktop", h(&["Desktop"])),
        ("documents", "Documents", h(&["Documents"])),
        ("downloads", "Downloads", h(&["Downloads"])),
        ("music", "Music", h(&["Music"])),
        ("pictures", "Pictures", h(&["Pictures"])),
        ("videos", "Videos", h(&["Videos"])),
    ];
    Ok(candidates
        .into_iter()
        .filter(|(_, _, path)| Path::new(path).is_dir() || path == &home.to_string_lossy())
        .map(|(id, label, path)| Place {
            id: id.into(),
            label: label.into(),
            path,
        })
        .collect())
}

/// Where the app opens on launch. `$HOME`, not `/` — landing in the
/// filesystem root is a disorienting place to start, it lists `bin`, `etc`
/// and `usr` before anything the user recognises, and it is two keystrokes
/// away via the path box when it is genuinely wanted. `FILY_START_DIR`
/// overrides, for anyone who does want to launch elsewhere.
#[tauri::command]
pub fn get_start_dir() -> Result<String, String> {
    if let Ok(p) = std::env::var("FILY_START_DIR") {
        if !p.trim().is_empty() {
            return Ok(p);
        }
    }
    dirs::home_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .ok_or_else(|| "No home directory".to_string())
}

#[tauri::command]
pub fn get_volumes() -> Result<Vec<Volume>, String> {
    // Home is the seed, not `/`. A "Root" shortcut next to "Home" duplicated
    // what the path box and "go up" already do, and in practice just invited
    // people to open a directory full of system folders by accident.
    let mut vols: Vec<Volume> = match dirs::home_dir() {
        Some(home) => vec![Volume {
            label: "Home".into(),
            path: home.to_string_lossy().into_owned(),
            total: None,
            available: None,
        }],
        None => vec![],
    };
    // Parse /proc/mounts for real mounted filesystems (Linux).
    #[cfg(target_os = "linux")]
    {
        if let Ok(text) = fs::read_to_string("/proc/mounts") {
            for line in text.lines() {
                let cols: Vec<&str> = line.split_whitespace().collect();
                if cols.len() < 3 {
                    continue;
                }
                let (dev, mnt, fstype) = (cols[0], cols[1], cols[2]);
                if !(mnt == "/"
                    || mnt.starts_with("/mnt")
                    || mnt.starts_with("/media")
                    || mnt.starts_with("/run/media"))
                {
                    continue;
                }
                if ["tmpfs", "devtmpfs", "squashfs", "overlay"].contains(&fstype) {
                    continue;
                }
                if mnt == "/" {
                    continue; // Home is already listed; "/" is not offered
                }
                // `mnt == "/"` is skipped above, so this is always a real mount.
                let label = format!(
                    "{} ({})",
                    Path::new(mnt)
                        .file_name()
                        .map(|s| s.to_string_lossy().into_owned())
                        .unwrap_or_else(|| mnt.to_string()),
                    dev
                );
                vols.push(Volume {
                    label,
                    path: mnt.to_string(),
                    total: None,
                    available: None,
                });
            }
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = &mut vols;
    }
    Ok(vols)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmpdir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "fily-test-{tag}-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn opts(q: &str) -> SearchOptions {
        SearchOptions {
            query: q.to_string(),
            recursive: true,
            extensions: vec![],
            min_size: None,
            max_size: None,
            modified_after: None,
            modified_before: None,
            max_results: None,
            max_depth: None,
        }
    }

    #[test]
    fn search_finds_nested_files_and_matches_whole_names() {
        let dir = tmpdir("search");
        fs::write(dir.join("alpha.txt"), "a").unwrap();
        fs::write(dir.join("report.pdf"), "a").unwrap();
        fs::create_dir_all(dir.join("sub/deep")).unwrap();
        fs::write(dir.join("sub/deep/report-draft.pdf"), "a").unwrap();
        fs::write(dir.join("sub/notes.md"), "a").unwrap();

        let hits = search_dir_blocking(dir.to_string_lossy().into_owned(), opts("report")).unwrap();
        let names: Vec<&str> = hits.iter().map(|e| e.name.as_str()).collect();
        assert!(names.contains(&"report.pdf"), "got {names:?}");
        assert!(
            names.contains(&"report-draft.pdf"),
            "nested hit missing: {names:?}"
        );
        assert!(
            !names.contains(&"notes.md"),
            "unrelated file matched: {names:?}"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn search_filters_by_extension_and_case_insensitively() {
        let dir = tmpdir("search-ext");
        fs::write(dir.join("Report.PDF"), "a").unwrap();
        fs::write(dir.join("report.txt"), "a").unwrap();

        let mut o = opts("report");
        o.extensions = vec!["pdf".into()];
        let hits = search_dir_blocking(dir.to_string_lossy().into_owned(), o).unwrap();
        assert_eq!(hits.len(), 1, "extension filter leaked");
        assert_eq!(hits[0].name, "Report.PDF");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn search_respects_max_results() {
        let dir = tmpdir("search-cap");
        for i in 0..40 {
            fs::write(dir.join(format!("match-{i}.txt")), "a").unwrap();
        }
        let mut o = opts("match");
        o.max_results = Some(5);
        let hits = search_dir_blocking(dir.to_string_lossy().into_owned(), o).unwrap();
        assert!(hits.len() <= 5, "cap ignored: {}", hits.len());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn dir_size_sums_recursively() {
        let dir = tmpdir("size");
        fs::create_dir_all(dir.join("sub")).unwrap();
        fs::write(dir.join("a.bin"), vec![0u8; 100]).unwrap();
        fs::write(dir.join("sub/b.bin"), vec![0u8; 250]).unwrap();
        let total = dir_size_blocking(dir.to_string_lossy().into_owned()).unwrap();
        assert_eq!(total, 350, "recursive size wrong");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn list_dir_reports_expected_shape() {
        let dir = tmpdir("list");
        fs::write(dir.join("one.txt"), "a").unwrap();
        fs::create_dir_all(dir.join("sub")).unwrap();
        let entries = list_dir_blocking(dir.to_string_lossy().into_owned(), false).unwrap();
        assert_eq!(entries.len(), 2);
        assert!(entries.iter().any(|e| e.is_dir && e.name == "sub"));
        assert!(entries.iter().any(|e| !e.is_dir && e.name == "one.txt"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn search_skips_cache_and_node_modules() {
        let dir = tmpdir("noise");
        fs::create_dir_all(dir.join(".cache/deep/deeper")).unwrap();
        fs::write(dir.join(".cache/needle1.txt"), "a").unwrap();
        fs::write(dir.join(".cache/deep/deeper/needle2.txt"), "a").unwrap();
        fs::create_dir_all(dir.join("node_modules/pkg")).unwrap();
        fs::write(dir.join("node_modules/pkg/needle3.txt"), "a").unwrap();
        fs::write(dir.join("needle-real.txt"), "a").unwrap();

        let hits = search_dir_blocking(dir.to_string_lossy().into_owned(), opts("needle")).unwrap();
        let names: Vec<&str> = hits.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["needle-real.txt"], "noise leaked: {names:?}");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn search_skips_sdk_and_toolchain_directories() {
        let dir = tmpdir("sdk");
        // Every directory the user asked to have skipped, including the
        // mixed-case SDK checkouts. Case-insensitive matching is what makes
        // bare `Android`/`Flutter` work.
        for noise in [
            ".gradle",
            ".codex",
            ".rustup",
            ".pub-cache",
            "Android",
            "Flutter",
            "android",
            "flutter",
            ".rustup/toolchains",
            "Android/sdk/platforms",
        ] {
            let d = dir.join(noise);
            fs::create_dir_all(&d).unwrap();
            fs::write(d.join("needle-hidden.txt"), "a").unwrap();
        }
        fs::write(dir.join("needle-real.txt"), "a").unwrap();

        let hits = search_dir_blocking(dir.to_string_lossy().into_owned(), opts("needle")).unwrap();
        let names: Vec<&str> = hits.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["needle-real.txt"], "SDK dirs leaked: {names:?}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn search_finds_a_top_level_folder_in_a_large_home() {
        // The reported failure: `~/InstaLy` was not returned even though it
        // exists. A depth-first walk commits to the first big subtree it meets
        // and can spend its whole visit budget down there, never surfacing the
        // folders sitting beside it. Breadth-first ordering fixes this, so the
        // budget gets spent on depth 1 first.
        let dir = tmpdir("starve");
        fs::create_dir_all(dir.join("zzz-InstaLy")).unwrap();
        fs::write(dir.join("zzz-InstaLy/app.js"), "a").unwrap();
        // A deep tree whose contents also match, so a result cap or visit
        // budget would be hit if it were walked before the top level. Named to
        // sort ahead of the folder above: depth-first traversal enters it
        // first and spends the entire budget down there, never surfacing the
        // sibling sitting right beside it.
        for i in 0..40 {
            let d = dir.join(format!("Projects/build{i}/deep/deeper"));
            fs::create_dir_all(&d).unwrap();
            for f in 0..40 {
                fs::write(d.join(format!("instaly{f}.dat")), "a").unwrap();
            }
        }

        let hits =
            search_dir_blocking(dir.to_string_lossy().into_owned(), opts("instaly")).unwrap();
        let names: Vec<&str> = hits.iter().map(|e| e.name.as_str()).collect();
        assert!(
            names.contains(&"zzz-InstaLy"),
            "top-level folder was starved: {:?}",
            &names[..names.len().min(8)]
        );
        // The folder must also lead: breadth-first reaches depth 1 first.
        assert_eq!(
            names.first(),
            Some(&"zzz-InstaLy"),
            "shallowest match must come first, got {names:?}"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn search_returns_folders_alongside_an_extension_filter() {
        // A directory has no extension, so filtering by extension used to
        // reject every folder: searching for a folder while any filter text
        // was present returned nothing at all.
        let dir = tmpdir("folderfilter");
        fs::create_dir_all(dir.join("InstaLy")).unwrap();
        fs::write(dir.join("report.pdf"), "a").unwrap();
        fs::write(dir.join("notes.txt"), "a").unwrap();

        let mut o = opts("instaly");
        o.extensions = vec!["pdf".to_string()];
        let hits = search_dir_blocking(dir.to_string_lossy().into_owned(), o).unwrap();
        let names: Vec<&str> = hits.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["InstaLy"], "folder dropped by ext filter");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn search_still_filters_files_by_extension() {
        let dir = tmpdir("extfilter");
        fs::create_dir_all(dir.join("InstaLy")).unwrap();
        fs::write(dir.join("report.pdf"), "a").unwrap();
        fs::write(dir.join("notes.txt"), "a").unwrap();

        // Empty query with a filter must return only the matching file plus
        // the folder -- not the .txt.
        let mut o = opts("");
        o.extensions = vec!["pdf".to_string()];
        let hits = search_dir_blocking(dir.to_string_lossy().into_owned(), o).unwrap();
        let mut names: Vec<&str> = hits.iter().map(|e| e.name.as_str()).collect();
        names.sort_unstable();
        assert_eq!(
            names,
            vec!["InstaLy", "report.pdf"],
            "filter wrong: {names:?}"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn search_finds_uppercase_named_folder_and_file() {
        let dir = tmpdir("upperfolder");
        fs::create_dir_all(dir.join("InstaLy")).unwrap();
        fs::write(dir.join("InstaLy/README.md"), "a").unwrap();
        fs::write(dir.join("REPORT.PDF"), "a").unwrap();

        let p = dir.to_string_lossy().into_owned();
        for q in [
            "instaly", "InstaLy", "INSTALY", "readme", "README", "report",
        ] {
            let hits = search_dir_blocking(p.clone(), opts(q)).unwrap();
            let names: Vec<&str> = hits.iter().map(|e| e.name.as_str()).collect();
            assert!(!names.is_empty(), "query {q} found nothing");
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn start_dir_is_home_not_root() {
        let start = get_start_dir().unwrap();
        assert!(
            !start.is_empty() && start != "/",
            "should open in $HOME, got {start:?}"
        );
        assert!(Path::new(&start).is_dir(), "{start} is not a directory");
        assert_eq!(
            start,
            dirs::home_dir().unwrap().to_string_lossy(),
            "start dir should be exactly $HOME"
        );
    }

    #[test]
    fn volumes_offer_home_and_never_root() {
        let vols = get_volumes().unwrap();
        assert!(
            !vols.iter().any(|v| v.path == "/"),
            "root must not be offered: {vols:?}"
        );
        let home = dirs::home_dir().unwrap().to_string_lossy().into_owned();
        assert!(
            vols.iter().any(|v| v.path == home),
            "home must still be offered: {vols:?}"
        );
        // No duplicate entries for the same path.
        let mut seen: Vec<&str> = vols.iter().map(|v| v.path.as_str()).collect();
        seen.sort_unstable();
        let before = seen.len();
        seen.dedup();
        assert_eq!(before, seen.len(), "duplicate volume paths: {vols:?}");
    }

    #[test]
    fn unreadable_archive_error_names_the_file() {
        // A bare zip-crate message ("Could not find EOCD") told the user
        // nothing about which file failed or why.
        let dir = tmpdir("badeocd");
        let bad = dir.join("holiday-photos.zip");
        fs::write(&bad, b"this is definitely not a zip file").unwrap();
        let out = dir.join("out");
        fs::create_dir_all(&out).unwrap();

        let err = extract_zip_to(&bad, &out, None).unwrap_err();
        assert!(
            err.contains("holiday-photos.zip"),
            "error must name the file: {err}"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn extract_zip_to_still_works_with_no_progress_sink() {
        // `app: None` is the path used by anything not running a UI; it must
        // extract correctly rather than quietly doing nothing.
        let dir = tmpdir("noprog");
        let zip_path = dir.join("bundle.zip");
        {
            let out = fs::File::create(&zip_path).unwrap();
            let mut w = zip::ZipWriter::new(out);
            w.start_file(
                "hello.txt",
                zip::write::SimpleFileOptions::default()
                    .compression_method(zip::CompressionMethod::Stored),
            )
            .unwrap();
            std::io::Write::write_all(&mut w, b"hello world").unwrap();
            w.finish().unwrap();
        }
        let dest = dir.join("unpacked");
        fs::create_dir_all(&dest).unwrap();
        let res = extract_zip_to(&zip_path, &dest, None).unwrap();
        assert!(res.ok, "extract failed: {:?}", res.failures);
        assert_eq!(
            fs::read_to_string(dest.join("hello.txt")).unwrap(),
            "hello world"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn search_ranks_nearest_results_first() {
        // Searching "w" in a home folder must surface the folder you are
        // standing in before an identically-named one buried in Documents.
        let dir = tmpdir("rank");
        fs::create_dir_all(dir.join("work")).unwrap();
        fs::write(dir.join("work/keep"), "a").unwrap();
        fs::create_dir_all(dir.join("Documents/my-work")).unwrap();
        fs::create_dir_all(dir.join("Documents/deep/deeper/deep-work")).unwrap();
        fs::write(dir.join("Documents/my-work-file.txt"), "a").unwrap();

        let hits = search_dir_blocking(dir.to_string_lossy().into_owned(), opts("work")).unwrap();
        let names: Vec<&str> = hits.iter().map(|e| e.name.as_str()).collect();

        // Depth 1 "work" leads; depth 2 file and folder follow; depth 4 last.
        assert_eq!(names[0], "work", "nearest match must lead: {names:?}");
        let pos = |n: &str| names.iter().position(|x| *x == n).unwrap_or(usize::MAX);
        assert!(
            pos("work") < pos("my-work") && pos("my-work") < pos("my-work-file.txt"),
            "shallower must precede deeper: {names:?}"
        );
        assert!(
            pos("my-work-file.txt") < pos("deep-work"),
            "depth 4 must come last: {names:?}"
        );
        // Folders still lead files at the same depth.
        assert!(
            pos("my-work") < pos("my-work-file.txt"),
            "folder must precede file at equal depth: {names:?}"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn tar_and_targz_extract_correctly() {
        // The backend only handled zip; a .tar.gz offered by the context menu
        // failed with a zip-crate error. Build each and unpack it.
        let dir = tmpdir("tar");

        fn add_entries<W: std::io::Write>(b: &mut tar::Builder<W>) {
            let body = b"hello from a tar";
            let mut header = tar::Header::new_gnu();
            header.set_size(body.len() as u64);
            header.set_mode(0o644);
            header.set_mtime(0);
            header.set_cksum();
            b.append_data(&mut header, "docs/readme.txt", &body[..])
                .unwrap();
            let csv = b"a,b\n1,2\n";
            let mut h2 = tar::Header::new_gnu();
            h2.set_size(csv.len() as u64);
            h2.set_mode(0o644);
            h2.set_mtime(0);
            h2.set_cksum();
            b.append_data(&mut h2, "data/values.csv", &csv[..]).unwrap();
        }

        let plain = dir.join("bundle.tar");
        {
            let f = fs::File::create(&plain).unwrap();
            let mut b = tar::Builder::new(f);
            add_entries(&mut b);
            b.into_inner().unwrap().sync_all().unwrap();
        }
        let gzed = dir.join("bundle.tar.gz");
        {
            let f = fs::File::create(&gzed).unwrap();
            let enc = flate2::write::GzEncoder::new(f, flate2::Compression::fast());
            let mut b = tar::Builder::new(enc);
            add_entries(&mut b);
            b.into_inner()
                .unwrap()
                .finish()
                .unwrap()
                .sync_all()
                .unwrap();
        }

        for name in ["bundle.tar", "bundle.tar.gz"] {
            let archive = dir.join(name);
            let dest = dir.join(format!("out-{}", name.replace('.', "_")));
            fs::create_dir_all(&dest).unwrap();

            let res = crate::archive_commands::extract_tar_to(&archive, &dest, None)
                .unwrap_or_else(|e| panic!("{name} failed: {e}"));
            assert!(res.ok, "{name}: {:?}", res.failures);
            assert_eq!(
                fs::read_to_string(dest.join("docs/readme.txt")).unwrap(),
                "hello from a tar",
                "{name} content wrong"
            );
            assert_eq!(
                fs::read_to_string(dest.join("data/values.csv")).unwrap(),
                "a,b\n1,2\n",
                "{name} second entry wrong"
            );
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn tar_refuses_path_escapes() {
        let dir = tmpdir("tarslip");
        let archive = dir.join("evil.tar");
        {
            let f = fs::File::create(&archive).unwrap();
            let mut b = tar::Builder::new(f);
            let body = b"nope";
            let mut header = tar::Header::new_gnu();
            header.set_size(body.len() as u64);
            header.set_mode(0o644);
            header.set_mtime(0);
            // `append_data` refuses to write a ".." path, so the hostile name
            // goes straight into the raw header bytes -- which is exactly
            // what an attacker would hand us.
            {
                header.as_mut_bytes()[..9].copy_from_slice(b"../escape");
            }
            header.set_cksum();
            b.append(&header, &body[..]).unwrap();
            b.into_inner().unwrap().sync_all().unwrap();
        }
        let dest = dir.join("out");
        fs::create_dir_all(&dest).unwrap();
        let res = crate::archive_commands::extract_tar_to(&archive, &dest, None).unwrap();
        assert!(!res.ok, "escape must be refused");
        assert!(!dir.join("escaped.txt").exists(), "nothing may escape");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn unsupported_archives_say_what_is_supported() {
        // Previously every non-zip produced "invalid Zip archive: Could not
        // find EOCD", naming neither the format nor the way out.
        for ok in [
            "a.zip",
            "a.jar",
            "a.apk",
            "a.tar",
            "a.tar.gz",
            "a.tgz",
            "a.tar.bz2",
            "a.tar.xz",
            "a.tar.zst",
            "a.7z",
        ] {
            assert!(
                crate::archive_commands::is_extractable(ok),
                "{ok} should extract"
            );
        }
        // RAR needs an external decoder, so it is never offered in the menu.
        assert!(!crate::archive_commands::is_extractable("a.rar"));
        assert!(!crate::archive_commands::is_extractable("notes.txt"));
        assert!(!crate::archive_commands::is_extractable("a.exe"));

        let dir = tmpdir("unsupported");
        let src = dir.join("bundle.rar");
        fs::write(&src, b"not really a rar").unwrap();
        let dest = dir.join("out");
        fs::create_dir_all(&dest).unwrap();
        let msg = extract_to_any(&src, &dest, None).unwrap_err();
        assert!(msg.contains("zip"), "should name what works: {msg}");
        assert!(msg.contains("7z"), "should list 7z as supported: {msg}");
        assert!(!msg.contains("EOCD"), "should not be a zip error: {msg}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn search_does_not_walk_tmp_or_proc() {
        let dir = tmpdir("prefix");
        fs::write(dir.join("keep.txt"), "a").unwrap();
        // Pruning by absolute prefix must NOT fire when the search root is
        // itself under that prefix: these temp dirs are, and an earlier
        // version of this rule pruned the root and returned zero results.
        assert!(
            !is_search_noise(&dir, &dir),
            "a root under /tmp must not prune itself"
        );
        assert!(
            !is_search_noise(&dir.join("keep.txt"), &dir),
            "a real file below the root must not be pruned"
        );
        assert!(
            is_search_noise(Path::new("/proc/1"), Path::new("/")),
            "/proc must be pruned when searching from /"
        );
        assert!(
            !is_search_noise(Path::new("/"), Path::new("/")),
            "root must never be pruned"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn noise_pruning_respects_the_search_root() {
        let dir = tmpdir("root-scope");
        // The search root itself may legitimately be called .cache.
        let root = dir.join(".cache");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("inside.txt"), "a").unwrap();
        let hits =
            search_dir_blocking(root.to_string_lossy().into_owned(), opts("inside")).unwrap();
        assert_eq!(hits.len(), 1, "searching inside .cache must still work");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn search_results_put_folders_first() {
        let dir = tmpdir("dirfirst");
        fs::write(dir.join("aaa.txt"), "a").unwrap();
        fs::write(dir.join("zzz.txt"), "a").unwrap();
        fs::create_dir_all(dir.join("mmm")).unwrap();
        fs::create_dir_all(dir.join("bbb")).unwrap();

        let hits = search_dir_blocking(dir.to_string_lossy().into_owned(), opts("")).unwrap();
        let kinds: Vec<(&str, bool)> = hits.iter().map(|e| (e.name.as_str(), e.is_dir)).collect();
        // Folders (mmm, bbb) ahead of files (aaa, zzz) despite the alphabet.
        assert_eq!(
            kinds,
            vec![
                ("bbb", true),
                ("mmm", true),
                ("aaa.txt", false),
                ("zzz.txt", false)
            ],
            "folders must come first: {kinds:?}"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn search_is_case_insensitive_for_uppercase_queries() {
        let dir = tmpdir("upper");
        fs::write(dir.join("Report.PDF"), "a").unwrap();
        fs::write(dir.join("holiday.jpeg"), "a").unwrap();
        let p = dir.to_string_lossy().into_owned();
        for q in ["report", "REPORT", "RePoRt", "HOLIDAY"] {
            let hits = search_dir_blocking(p.clone(), opts(q)).unwrap();
            assert_eq!(hits.len(), 1, "query {q} matched {:?}", hits.len());
        }
        let _ = fs::remove_dir_all(&dir);
    }
}
