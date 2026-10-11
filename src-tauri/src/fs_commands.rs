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
    let is_symlink = fs::symlink_metadata(path)
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false);
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

/// Directory names that are never worth searching: caches, VCS internals and
/// dependency trees. Matched exactly (case-insensitively) rather than by
/// substring, so a project legitimately called `git` is not pruned.
const NOISE_DIRS: [&str; 10] = [
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
    // Prune when any component strictly below the root is a known noise dir.
    // This covers descendants of the root as well as the directory itself,
    // since for `root/.cache` the relative path is just ".cache".
    match path.strip_prefix(root) {
        Ok(rel) => rel.components().any(|c| {
            let name = c.as_os_str().to_string_lossy();
            NOISE_DIRS.iter().any(|d| name.eq_ignore_ascii_case(d))
        }),
        // Outside the root entirely: leave the prefix rules above to decide.
        Err(_) => false,
    }
}

fn matches_search(path: &Path, entry: &FileEntry, opts: &SearchOptions, q: &str) -> bool {
    if !logic::name_matches(&entry.name, q) {
        return false;
    }
    if !opts.extensions.is_empty() {
        let ext = entry.extension.to_lowercase();
        if !opts
            .extensions
            .iter()
            .any(|e| e.trim_start_matches('.').to_lowercase() == ext)
        {
            return false;
        }
    }
    if let Some(min) = opts.min_size {
        if !entry.is_dir && entry.size < min {
            return false;
        }
    }
    if let Some(max) = opts.max_size {
        if !entry.is_dir && entry.size > max {
            return false;
        }
    }
    if let Some(after) = opts.modified_after {
        if entry.modified.map(|m| m < after).unwrap_or(true) {
            return false;
        }
    }
    if let Some(before) = opts.modified_before {
        if entry.modified.map(|m| m > before).unwrap_or(true) {
            return false;
        }
    }
    let _ = path;
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
    let noise_root = root.clone();
    let walker = walkdir::WalkDir::new(&root)
        .max_depth(depth)
        .follow_links(false)
        .into_iter()
        // Prune whole subtrees that never contain anything a person is
        // looking for. `.cache` under $HOME alone can hold tens of thousands
        // of files, and walking them burns the whole result budget on noise
        // that then buries the real matches.
        .filter_entry(move |e| !is_search_noise(e.path(), &noise_root));
    let mut out = Vec::new();
    let mut visited = 0usize;
    for item in walker.filter_map(|e| e.ok()) {
        if out.len() >= max_results {
            break;
        }
        visited += 1;
        if visited % 1024 == 0 {
            // Superseded by a newer search, or past a sane walk budget:
            // stop early and return what we have.
            if GENERATION.load(std::sync::atomic::Ordering::SeqCst) != gen || visited > 300_000 {
                break;
            }
        }
        let p = item.path();
        if p == root {
            continue;
        }
        let meta = match fs::symlink_metadata(p) {
            Ok(m) => m,
            Err(_) => continue,
        };
        let entry = entry_from_path(p, &meta);
        if matches_search(p, &entry, &options, &q) {
            out.push(entry);
        }
    }
    // Folders first, then by name — the same order the list view uses, so a
    // search reads like a folder listing rather than an interleaved mess.
    out.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(out)
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

#[tauri::command]
pub async fn extract_archive(path: String, dest_dir: String) -> Result<OpResult, String> {
    offload("Extract", move || extract_archive_blocking(path, dest_dir)).await
}

fn extract_archive_blocking(path: String, dest_dir: String) -> Result<OpResult, String> {
    let src = valid_path(&path)?;
    let dest = valid_path(&dest_dir)?;
    if !dest.is_dir() {
        return err("Destination is not a folder");
    }
    extract_zip_to(&src, &dest)
}

/// Shared zip extraction with zip-slip protection. Both `extract_archive`
/// and `extract_here` go through this function.
pub(crate) fn extract_zip_to(src: &Path, dest: &Path) -> Result<OpResult, String> {
    let f = fs::File::open(&src).map_err(|e| format!("Cannot open archive: {e}"))?;
    let mut zip = zip::ZipArchive::new(f).map_err(|e| format!("Unsupported archive: {e}"))?;
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

#[tauri::command]
pub fn get_volumes() -> Result<Vec<Volume>, String> {
    let mut vols = vec![Volume {
        label: "Root".into(),
        path: "/".into(),
        total: None,
        available: None,
    }];
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
                    continue; // static "Root" entry above already covers this
                }
                let label = if mnt == "/" {
                    "Root".to_string()
                } else {
                    format!(
                        "{} ({})",
                        Path::new(mnt)
                            .file_name()
                            .map(|s| s.to_string_lossy().into_owned())
                            .unwrap_or_else(|| mnt.to_string()),
                        dev
                    )
                };
                vols.push(Volume {
                    label,
                    path: mnt.to_string(),
                    total: None,
                    available: None,
                });
            }
        }
        if let Some(home) = dirs::home_dir() {
            let h = home.to_string_lossy().into_owned();
            if !vols.iter().any(|v| v.path == h) {
                vols.push(Volume {
                    label: "Home".into(),
                    path: h,
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
