//! Archive creation and "extract here" for Fily.
//!
//! `extract_archive` (extract to a chosen folder) lives in `fs_commands` and
//! shares `extract_to_any` below. Everything here streams file contents —
//! archives are never fully buffered in memory.

use flate2::read::GzDecoder;
use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use walkdir::WalkDir;
use zip::write::SimpleFileOptions;

use crate::fs_commands::{err, report_progress, valid_path};
use crate::fs_commands::{extract_to_any, OpFailure, OpProgress, OpResult};
use crate::logic;

/// Archive kinds we can actually unpack. The frontend offers the "Extract"
/// entries from the same list, so the menu never offers an action that fails.
pub fn is_extractable(name: &str) -> bool {
    let n = name.to_lowercase();
    n.ends_with(".zip") || n.ends_with(".tar") || n.ends_with(".tar.gz") || n.ends_with(".tgz")
}

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
pub async fn compress_zip(
    sources: Vec<String>,
    dest_file: String,
    overwrite: Option<bool>,
) -> Result<OpResult, String> {
    crate::fs_commands::offload("Compress", move || {
        compress_zip_blocking(sources, dest_file, overwrite)
    })
    .await
}

fn compress_zip_blocking(
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

/// Number of entries in a tar archive, read by walking headers only — no
/// payload is decompressed, so this is a seek rather than a full read. It is
/// what makes the progress bar a real percentage instead of a crawl.
pub(crate) fn tar_entry_count(open: &dyn Fn() -> io::Result<Box<dyn Read>>) -> io::Result<u64> {
    let reader = open()?;
    let mut ar = tar::Archive::new(reader);
    let mut n = 0u64;
    for entry in ar.entries()? {
        if entry.is_ok() {
            n += 1;
        }
    }
    Ok(n)
}

/// Extract a tar archive (optionally gzipped) with zip-slip protection and
/// progress reporting.
///
/// The entry count is known only by walking the headers, so this reads the
/// header chain once to count and again to extract. Headers are tiny and no
/// payload is decompressed for the counting pass, so it costs a seek rather
/// than a full read — and it is what lets the bar show a real percentage
/// instead of an indeterminate crawl.
pub fn extract_tar_to(
    src: &Path,
    dest: &Path,
    app: Option<&tauri::AppHandle>,
) -> Result<OpResult, String> {
    // Existence is checked by the `open` closure below; opening it twice would
    // only produce a second identical error.
    let lower = src
        .file_name()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    // Decompression wrapper, chosen by extension. xz/bz2/zstd are not linked
    // in, so those are reported plainly rather than failing obscurely.
    let gz = lower.ends_with(".gz") || lower.ends_with(".tgz");
    if lower.ends_with(".xz")
        || lower.ends_with(".txz")
        || lower.ends_with(".bz2")
        || lower.ends_with(".tbz2")
        || lower.ends_with(".zst")
    {
        return err(format!(
            "{lower} is not supported yet. Repack it as .tar, .tar.gz or .zip."
        ));
    }

    let open = || -> io::Result<Box<dyn Read>> {
        let f = fs::File::open(src)?;
        if gz {
            Ok(Box::new(GzDecoder::new(f)))
        } else {
            Ok(Box::new(f))
        }
    };

    // Count entries by walking headers only. This is the progress bar's
    // denominator, so it has to agree with what the extract pass actually
    // writes -- a wrong total makes the percentage meaningless.
    let total = tar_entry_count(&open).map_err(|e| format!("Not a readable tar archive: {e}"))?;

    let archive_name = src
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "archive".into());
    let id = format!("extract:{}", src.to_string_lossy());
    let label = format!("Extracting {archive_name}");
    let step = (total / 100).max(1);

    let reader = open().map_err(|e| format!("Cannot read archive: {e}"))?;
    let mut ar = tar::Archive::new(reader);
    let entries = ar
        .entries()
        .map_err(|e| format!("Not a readable tar archive: {e}"))?;

    let mut result = OpResult {
        ok: true,
        failures: vec![],
        conflicts: vec![],
    };
    let mut done = 0u64;
    for entry in entries {
        let mut entry = match entry {
            Ok(e) => e,
            Err(e) => {
                result.ok = false;
                result.failures.push(op_fail(
                    archive_name.clone(),
                    format!("Cannot read entry: {e}"),
                ));
                continue;
            }
        };
        let raw = entry
            .path()
            .map_err(|e| {
                result.ok = false;
                format!("Bad entry name: {e}")
            })
            .unwrap_or_default();
        let name = raw.to_string_lossy().into_owned();
        report_progress(
            app,
            &OpProgress {
                id: id.clone(),
                label: label.clone(),
                current: name.clone(),
                done,
                total,
                finished: false,
            },
            step,
        );

        // Same escape refusal as the zip path.
        let joined = dest.join(&raw);
        if !joined.starts_with(dest) {
            result.ok = false;
            result
                .failures
                .push(op_fail(name, "Refused unsafe entry (path escape)".into()));
            done += 1;
            continue;
        }
        done += 1;

        let unpack = entry.unpack_in(dest);
        match unpack {
            Ok(true) => {}
            // `unpack_in` returns Ok(false) for an entry it refused to write
            // because the path would have escaped the destination. Treating
            // that as success means silently extracting less than the archive
            // claimed, with no warning at all.
            Ok(false) => {
                result.ok = false;
                result
                    .failures
                    .push(op_fail(name, "Refused unsafe entry (path escape)".into()));
            }
            Err(e) => {
                result.ok = false;
                result
                    .failures
                    .push(op_fail(name, format!("Cannot extract: {e}")));
            }
        }
    }

    report_progress(
        app,
        &OpProgress {
            id,
            label,
            current: String::new(),
            done: total.max(done),
            total,
            finished: true,
        },
        1,
    );
    Ok(result)
}

/// Extract `path` into a new sibling folder named after the archive
/// (`photos.zip` -> `./photos/`, with ` (n)` on collision).
#[tauri::command]
pub async fn extract_here(app: tauri::AppHandle, path: String) -> Result<OpResult, String> {
    crate::fs_commands::offload("Extract", move || extract_here_blocking(&app, path)).await
}

fn extract_here_blocking(app: &tauri::AppHandle, path: String) -> Result<OpResult, String> {
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
    match extract_to_any(&src, &dest, Some(app)) {
        Err(e) => {
            let _ = fs::remove_dir(&dest);
            Err(e)
        }
        ok => ok,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn build_tar(path: &Path, entries: &[(&str, &[u8])]) {
        let f = fs::File::create(path).unwrap();
        let mut b = tar::Builder::new(f);
        for (name, body) in entries {
            let mut h = tar::Header::new_gnu();
            h.set_size(body.len() as u64);
            h.set_mode(0o644);
            h.set_mtime(0);
            h.set_cksum();
            b.append_data(&mut h, name, *body).unwrap();
        }
        b.into_inner().unwrap().sync_all().unwrap();
    }

    fn opener(path: &Path) -> Box<dyn Fn() -> io::Result<Box<dyn Read>>> {
        let p = path.to_path_buf();
        Box::new(move || Ok(Box::new(fs::File::open(&p)?) as Box<dyn Read>))
    }

    #[test]
    fn entry_count_matches_what_is_written() {
        // The progress denominator. If this disagrees with the extract pass,
        // the bar shows a percentage that means nothing.
        let dir = std::env::temp_dir().join(format!("fily-tarcount-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let archive = dir.join("c.tar");
        let spec: Vec<(&str, &[u8])> = vec![
            ("a.txt", b"one"),
            ("b.txt", b"two"),
            ("sub/c.txt", b"three"),
            ("sub/d.txt", b"four"),
            ("sub/e.txt", b"five"),
        ];
        build_tar(&archive, &spec);

        let counted = tar_entry_count(&*opener(&archive)).unwrap();
        assert_eq!(counted as usize, spec.len(), "header count wrong");

        let dest = dir.join("out");
        fs::create_dir_all(&dest).unwrap();
        let res = extract_tar_to(&archive, &dest, None).unwrap();
        assert!(res.ok, "{:?}", res.failures);
        for (name, body) in &spec {
            assert_eq!(&fs::read(dest.join(name)).unwrap(), body, "{name}");
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn gzipped_count_matches_too() {
        let dir = std::env::temp_dir().join(format!("fily-tarcount-gz-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let archive = dir.join("c.tar.gz");
        {
            let f = fs::File::create(&archive).unwrap();
            let enc = flate2::write::GzEncoder::new(f, flate2::Compression::fast());
            let mut b = tar::Builder::new(enc);
            for i in 0..3 {
                let body = format!("body {i}");
                let mut h = tar::Header::new_gnu();
                h.set_size(body.len() as u64);
                h.set_mode(0o644);
                h.set_mtime(0);
                h.set_cksum();
                b.append_data(&mut h, format!("f{i}.txt"), body.as_bytes())
                    .unwrap();
            }
            b.into_inner()
                .unwrap()
                .finish()
                .unwrap()
                .sync_all()
                .unwrap();
        }
        let p = archive.clone();
        let counted = tar_entry_count(&*Box::new(move || {
            Ok(Box::new(GzDecoder::new(fs::File::open(&p)?)) as Box<dyn Read>)
        }))
        .unwrap();
        assert_eq!(counted, 3);
        let _ = fs::remove_dir_all(&dir);
    }
}
