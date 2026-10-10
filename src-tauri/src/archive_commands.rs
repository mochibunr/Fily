//! Archive creation and "extract here" for Fily.
//!
//! `extract_archive` (extract to a chosen folder) lives in `fs_commands` and
//! shares `extract_zip_to` below. Everything here streams file contents —
//! archives are never fully buffered in memory.

use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use walkdir::WalkDir;
use zip::write::SimpleFileOptions;

use crate::fs_commands::{err, valid_path};
use crate::fs_commands::{extract_zip_to, OpFailure, OpResult};
use crate::logic;

fn op_fail(path: String, message: String) -> OpFailure {
    OpFailure { path, message }
}

fn zip_options() -> SimpleFileOptions {
    SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o644)
}

fn dir_options() -> SimpleFileOptions {
    SimpleFileOptions::default().unix_permissions(0o755)
}

/// Create a `.zip` archive at `dest_file` containing `sources`.
/// Each source lands under a top-level folder named after itself.
#[tauri::command]
pub fn compress_zip(
    sources: Vec<String>,
    dest_file: String,
    overwrite: Option<bool>,
) -> Result<OpResult, String> {
    if sources.is_empty() {
        return err("Nothing selected to compress");
    }
    let mut dest = valid_path(&dest_file)?;
    if dest.extension().map(|e| e.to_ascii_lowercase()) != Some("zip".into()) {
        dest.set_extension("zip");
    }
    let parent = dest
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "Invalid destination".to_string())?;
    if !parent.is_dir() {
        return err("Destination folder does not exist");
    }
    if dest.exists() || fs::symlink_metadata(&dest).is_ok() {
        if !overwrite.unwrap_or(false) {
            return Ok(OpResult {
                ok: false,
                failures: vec![],
                conflicts: vec![dest.to_string_lossy().into_owned()],
            });
        }
        fs::remove_file(&dest).map_err(|e| format!("Cannot replace existing file: {e}"))?;
    }

    let mut valid_src: Vec<PathBuf> = Vec::with_capacity(sources.len());
    for raw in &sources {
        let p = valid_path(raw)?;
        if fs::symlink_metadata(&p).is_err() {
            return err(format!("File no longer exists: {raw}"));
        }
        valid_src.push(p);
    }

    let out = fs::File::create(&dest).map_err(|e| format!("Cannot create archive: {e}"))?;
    let mut writer = zip::ZipWriter::new(out);
    let mut result = OpResult {
        ok: true,
        failures: vec![],
        conflicts: vec![],
    };

    for src in &valid_src {
        let base = src
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| "item".to_string());
        // Single file: store it directly (no wrapper folder) when it is the
        // only source; otherwise each source gets its own top-level folder.
        let wrap = valid_src.len() > 1 || src.is_dir();
        for item in WalkDir::new(src).follow_links(false).into_iter() {
            let item = match item {
                Ok(i) => i,
                Err(e) => {
                    result.ok = false;
                    result
                        .failures
                        .push(op_fail(src.to_string_lossy().into_owned(), e.to_string()));
                    continue;
                }
            };
            let disk = item.path();
            let rel = match disk.strip_prefix(src) {
                Ok(r) => r,
                Err(_) => continue,
            };
            let arc_name = if rel.as_os_str().is_empty() {
                if !wrap {
                    base.clone()
                } else {
                    format!("{base}/")
                }
            } else if wrap {
                format!("{}/{}", base, rel.to_string_lossy().replace('\\', "/"))
            } else {
                rel.to_string_lossy().replace('\\', "/")
            };
            let meta = match fs::symlink_metadata(disk) {
                Ok(m) => m,
                Err(e) => {
                    result.ok = false;
                    result
                        .failures
                        .push(op_fail(disk.to_string_lossy().into_owned(), e.to_string()));
                    continue;
                }
            };
            if meta.file_type().is_symlink() {
                result.ok = false;
                result.failures.push(op_fail(
                    disk.to_string_lossy().into_owned(),
                    "Skipped symbolic link".into(),
                ));
                continue;
            }
            let step: io::Result<()> = (|| {
                if meta.is_dir() {
                    let name = if arc_name.ends_with('/') {
                        arc_name.clone()
                    } else {
                        format!("{arc_name}/")
                    };
                    writer.add_directory(name, dir_options())?;
                } else {
                    writer.start_file(arc_name.clone(), zip_options())?;
                    let mut f = fs::File::open(disk)?;
                    io::copy(&mut f, &mut writer)?;
                }
                Ok(())
            })();
            if let Err(e) = step {
                result.ok = false;
                result
                    .failures
                    .push(op_fail(arc_name, format!("Cannot add to archive: {e}")));
            }
        }
    }

    match writer.finish() {
        Ok(mut f) => {
            if let Err(e) = f.flush() {
                let _ = fs::remove_file(&dest);
                return err(format!("Cannot write archive: {e}"));
            }
        }
        Err(e) => {
            let _ = fs::remove_file(&dest);
            return err(format!("Cannot write archive: {e}"));
        }
    }
    Ok(result)
}

/// Extract `path` into a new sibling folder named after the archive
/// (`photos.zip` -> `./photos/`, with ` (n)` on collision).
#[tauri::command]
pub fn extract_here(path: String) -> Result<OpResult, String> {
    let src = valid_path(&path)?;
    if !src.is_file() {
        return err("Not a file");
    }
    let parent = src
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "Invalid path".to_string())?;
    let stem = src
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "archive".to_string());
    // A `.tar.gz` stem is `photos.tar` — drop the `.tar` too.
    let stem = stem.strip_suffix(".tar").unwrap_or(&stem).to_string();
    let folder = logic::keep_both_name(&stem, |n| parent.join(n).exists());
    let dest = parent.join(&folder);
    fs::create_dir(&dest).map_err(|e| format!("Cannot create folder: {e}"))?;
    // Don't leave an empty folder behind when the archive can't be read.
    match extract_zip_to(&src, &dest) {
        Err(e) => {
            let _ = fs::remove_dir(&dest);
            Err(e)
        }
        ok => ok,
    }
}
