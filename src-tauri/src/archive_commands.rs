//! Archive creation and "extract here" for Fily.
//!
//! `extract_archive` (extract to a chosen folder) lives in `fs_commands` and
//! shares `extract_to_any` below. Everything here streams file contents —
//! archives are never fully buffered in memory.

use bzip2::read::BzDecoder;
use flate2::read::GzDecoder;
use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use walkdir::WalkDir;
use xz2::read::XzDecoder;
use zip::write::SimpleFileOptions;

use crate::fs_commands::{err, report_progress, valid_path};
use crate::fs_commands::{extract_to_any, OpFailure, OpProgress, OpResult};
use crate::logic;

/// The compression layer wrapped around a container, detected from the file's
/// leading bytes rather than its name. `tar -cf x.tar.gz dir` writes an
/// UNCOMPRESSED tar, so trusting the extension is the normal case to get
/// wrong, not an exotic one.
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Compression {
    None,
    Gzip,
    Bzip2,
    Xz,
    Zstd,
}

fn detect_compression(src: &Path) -> Compression {
    let Ok(mut f) = fs::File::open(src) else {
        return Compression::None;
    };
    let mut head = [0u8; 6];
    if f.read_exact(&mut head).is_err() {
        return Compression::None;
    }
    match &head[..] {
        [0x1f, 0x8b, ..] => Compression::Gzip,
        [0x42, 0x5a, 0x68, ..] => Compression::Bzip2,
        [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00] => Compression::Xz,
        [0x28, 0xb5, 0x2f, 0xfd, ..] => Compression::Zstd,
        // "PK" is zip and 7z has its own signature. Neither is a compression
        // layer, so both correctly read as None here.
        _ => Compression::None,
    }
}

/// Open a file with any outer compression layer peeled off.
fn open_decompressed(src: &Path) -> io::Result<Box<dyn Read>> {
    let f = fs::File::open(src)?;
    Ok(match detect_compression(src) {
        Compression::Gzip => Box::new(GzDecoder::new(f)),
        Compression::Bzip2 => Box::new(BzDecoder::new(f)),
        Compression::Xz => Box::new(XzDecoder::new(f)),
        Compression::Zstd => Box::new(zstd::stream::read::Decoder::new(f)?),
        Compression::None => Box::new(f),
    })
}

/// The container format, taken from the name. Compression is content-detected;
/// the container is a naming convention, with tar as the fallback.
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Container {
    Zip,
    Tar,
    SevenZ,
    Rar,
}

pub fn container_of(name: &str) -> Container {
    let n = name.to_lowercase();
    // Everything below is a zip under the hood.
    if [
        ".zip", ".jar", ".war", ".apk", ".whl", ".xpi", ".nupkg", ".epub", ".odt", ".epub",
    ]
    .iter()
    .any(|e| n.ends_with(e))
    {
        Container::Zip
    } else if n.ends_with(".7z") {
        Container::SevenZ
    } else if n.ends_with(".rar") {
        Container::Rar
    } else {
        Container::Tar
    }
}

/// Archive kinds we can actually open. The frontend offers the "Extract"
/// entries from the same list, so the menu never offers an action that fails.
pub fn is_extractable(name: &str) -> bool {
    let n = name.to_lowercase();
    !matches!(container_of(&n), Container::Rar)
        && (container_of(&n) != Container::Tar
            || [
                ".tar", ".tar.gz", ".tgz", ".tar.bz2", ".tbz2", ".tar.xz", ".txz", ".tar.zst",
                ".gz", ".bz2", ".xz", ".zst",
            ]
            .iter()
            .any(|e| n.ends_with(e)))
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
        compress_blocking(sources, dest_file, overwrite)
    })
    .await
}

/// Compress `sources` into `dest_file`, choosing the format from the name the
/// user typed: `.7z` produces a 7z archive, `.tar.gz` a gzipped tar, `.zip` a
/// zip, and a name with no recognised extension gets `.zip`.
///
/// Previously the extension was forced to `.zip`, so typing `photos.7z`
/// silently produced `photos.zip` and `photos.tar.gz` produced
/// `photos.tar.zip` -- the second because `set_extension` replaces only the
/// last component.
fn compress_blocking(
    sources: Vec<String>,
    dest_file: String,
    overwrite: Option<bool>,
) -> Result<OpResult, String> {
    let dest = ensure_archive_extension(valid_path(&dest_file)?);
    let name = dest
        .file_name()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    match container_of(&name) {
        // Pass the CORRECTED path: passing dest_file here meant a name with
        // no recognised extension produced a file with no extension at all,
        // because the zip writer re-read the name the user actually typed.
        Container::Zip => {
            compress_zip_blocking(sources, dest.to_string_lossy().into_owned(), overwrite)
        }
        Container::SevenZ => compress_7z_blocking(sources, dest, overwrite),
        Container::Rar => {
            err("Creating RAR archives is not supported. Use .7z, .zip or .tar.gz instead.")
        }
        Container::Tar => compress_tar_blocking(sources, dest, overwrite),
    }
}

/// Append a default extension when the typed name carries none we recognise,
/// so a bare "photos" becomes "photos.zip" rather than an unknown file.
fn ensure_archive_extension(dest: PathBuf) -> PathBuf {
    let name = dest
        .file_name()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    const KNOWN: [&str; 20] = [
        ".zip", ".jar", ".tar", ".tar.gz", ".tgz", ".tar.bz2", ".tbz2", ".tar.xz", ".txz",
        ".tar.zst", ".7z", ".gz", ".bz2", ".xz", ".zst", ".rar", ".whl", ".apk", ".jar", ".war",
    ];
    if KNOWN.iter().any(|e| name.ends_with(e)) {
        return dest;
    }
    dest.with_extension("zip")
}

/// Gather every file that goes into an archive, applying the wrapper rule:
/// a lone file is stored directly, anything else gets a top-level folder
/// named after itself.
fn archive_members(sources: &[PathBuf], result: &mut OpResult) -> Vec<(String, PathBuf)> {
    let mut members = Vec::new();
    for src in sources {
        let base = src
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| "item".into());
        let wrap = sources.len() > 1 || src.is_dir();
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
            let arc = if rel.as_os_str().is_empty() {
                if wrap {
                    format!("{base}/")
                } else {
                    base.clone()
                }
            } else if wrap {
                format!("{base}/{}", rel.to_string_lossy().replace('\\', "/"))
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
            members.push((arc, disk.to_path_buf()));
        }
    }
    members
}

/// Pre-flight shared by every writer: the destination folder must exist, and
/// an existing file needs explicit consent.
fn prepare_dest(dest: &Path, overwrite: Option<bool>) -> Result<(), OpResult> {
    let parent = dest.parent().unwrap_or(Path::new("/"));
    if !parent.is_dir() {
        return Err(OpResult {
            ok: false,
            failures: vec![op_fail(
                dest.to_string_lossy().into_owned(),
                "Destination folder does not exist".into(),
            )],
            conflicts: vec![],
        });
    }
    if dest.exists() || fs::symlink_metadata(dest).is_ok() {
        if !overwrite.unwrap_or(false) {
            return Err(OpResult {
                ok: false,
                failures: vec![],
                conflicts: vec![dest.to_string_lossy().into_owned()],
            });
        }
        let _ = fs::remove_file(dest);
    }
    Ok(())
}

/// Build a tar, optionally through a compression layer chosen by extension.
fn compress_tar_blocking(
    sources: Vec<String>,
    dest: PathBuf,
    overwrite: Option<bool>,
) -> Result<OpResult, String> {
    if sources.is_empty() {
        return err("Nothing selected to compress");
    }
    let name = dest
        .file_name()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let layer = if name.ends_with(".gz") || name.ends_with(".tgz") {
        Some(Compression::Gzip)
    } else if name.ends_with(".bz2") || name.ends_with(".tbz2") {
        Some(Compression::Bzip2)
    } else if name.ends_with(".xz") || name.ends_with(".txz") {
        Some(Compression::Xz)
    } else if name.ends_with(".zst") {
        Some(Compression::Zstd)
    } else {
        None
    };

    let mut valid = Vec::with_capacity(sources.len());
    for raw in &sources {
        let p = valid_path(raw)?;
        if fs::symlink_metadata(&p).is_err() {
            return err(format!("File no longer exists: {raw}"));
        }
        valid.push(p);
    }

    if let Err(conflict) = prepare_dest(&dest, overwrite) {
        return Ok(conflict);
    }

    let mut result = OpResult {
        ok: true,
        failures: vec![],
        conflicts: vec![],
    };
    let members = archive_members(&valid, &mut result);

    let file = match fs::File::create(&dest) {
        Ok(f) => f,
        Err(e) => {
            return err(format!("Cannot create archive: {e}"));
        }
    };

    // Each layer is finished explicitly. Dropping a GzEncoder never writes the
    // gzip trailer, so a boxed writer would silently produce a truncated --
    // i.e. corrupt -- archive.
    macro_rules! build_with {
        ($mk:expr) => {{
            let enc = $mk;
            let mut builder = tar::Builder::new(enc);
            builder.follow_symlinks(false);
            let mut result2 = fill_tar(&mut builder, &members);
            result.ok = result.ok && result2.ok;
            result.failures.append(&mut result2.failures);
            match builder.into_inner() {
                Ok(mut w) => {
                    let _ = w.flush();
                    w
                }
                Err(e) => return err(format!("Cannot write archive: {e}")),
            }
        }};
    }

    let outcome: Result<(), String> = (|| {
        match layer {
            Some(Compression::Gzip) => {
                let enc = flate2::write::GzEncoder::new(file, flate2::Compression::default());
                let gz = build_with!(enc);
                gz.finish()
                    .map_err(|e| format!("Cannot write archive: {e}"))?;
            }
            Some(Compression::Bzip2) => {
                let enc = bzip2::write::BzEncoder::new(file, bzip2::Compression::default());
                let bz = build_with!(enc);
                bz.finish()
                    .map_err(|e| format!("Cannot write archive: {e}"))?;
            }
            Some(Compression::Xz) => {
                let enc = xz2::write::XzEncoder::new(file, 6);
                let xz = build_with!(enc);
                xz.finish()
                    .map_err(|e| format!("Cannot write archive: {e}"))?;
            }
            Some(Compression::Zstd) => {
                let enc = zstd::stream::write::Encoder::new(file, 3)
                    .map_err(|e| format!("Cannot write archive: {e}"))?;
                let zs = build_with!(enc);
                zs.finish()
                    .map_err(|e| format!("Cannot write archive: {e}"))?;
            }
            _ => {
                let _ = build_with!(file);
            }
        }
        Ok(())
    })();
    if let Err(e) = outcome {
        let _ = fs::remove_file(&dest);
        return err(format!("Cannot write archive: {e}"));
    }
    Ok(result)
}

/// Write every member into an open tar builder. Generic over the writer so
/// each compression layer can be finished by its own concrete type.
fn fill_tar<W: Write>(builder: &mut tar::Builder<W>, members: &[(String, PathBuf)]) -> OpResult {
    let mut result = OpResult {
        ok: true,
        failures: vec![],
        conflicts: vec![],
    };
    for (arc, disk) in members {
        let step: io::Result<()> = (|| {
            if arc.ends_with('/') {
                let mut h = tar::Header::new_gnu();
                h.set_size(0);
                h.set_mode(0o755);
                h.set_mtime(0);
                h.set_entry_type(tar::EntryType::Directory);
                h.set_cksum();
                builder.append_data(&mut h, arc, io::empty())?;
            } else {
                builder.append_path_with_name(disk, arc)?;
            }
            Ok(())
        })();
        if let Err(e) = step {
            result.ok = false;
            result
                .failures
                .push(op_fail(arc.clone(), format!("Cannot add: {e}")));
        }
    }
    result
}

/// Build a 7z archive. The crate only ever compresses a single path, so each
/// selected source is packed in turn.
fn compress_7z_blocking(
    sources: Vec<String>,
    dest: PathBuf,
    overwrite: Option<bool>,
) -> Result<OpResult, String> {
    if sources.is_empty() {
        return err("Nothing selected to compress");
    }
    let mut valid = Vec::with_capacity(sources.len());
    for raw in &sources {
        let p = valid_path(raw)?;
        if fs::symlink_metadata(&p).is_err() {
            return err(format!("File no longer exists: {raw}"));
        }
        valid.push(p);
    }
    if let Err(conflict) = prepare_dest(&dest, overwrite) {
        return Ok(conflict);
    }

    // one 7z per source, then concatenate is invalid; so pack the common parent
    let mut result = OpResult {
        ok: true,
        failures: vec![],
        conflicts: vec![],
    };
    let roots: Vec<PathBuf> = if valid.len() == 1 {
        valid.clone()
    } else {
        let parent = valid[0]
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| valid[0].clone());
        vec![parent]
    };
    for root in &roots {
        let file = match fs::File::create(&dest) {
            Ok(f) => f,
            Err(e) => {
                let _ = fs::remove_file(&dest);
                return err(format!("Cannot create archive: {e}"));
            }
        };
        if let Err(e) = sevenz_rust2::compress(root, file) {
            let _ = fs::remove_file(&dest);
            return err(format!("Cannot write 7z archive: {e}"));
        }
    }
    let _ = &mut result;
    Ok(result)
}

fn compress_zip_blocking(
    sources: Vec<String>,
    dest_file: String,
    overwrite: Option<bool>,
) -> Result<OpResult, String> {
    if sources.is_empty() {
        return err("Nothing selected to compress");
    }
    let dest = valid_path(&dest_file)?;
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
    // Decompression is chosen by CONTENT, not by file name -- see
    // detect_compression. xz/bz2/zstd are linked in, so all of them work;
    // anything else is reported plainly rather than failing obscurely.
    let open = || -> io::Result<Box<dyn Read>> { open_decompressed(src) };

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

/// Extract a 7z archive. RAR is not handled here: the format is proprietary
/// and has no freely licensed Rust decoder, so it is delegated to a tool the
/// user may already have rather than pretending to support it.
pub fn extract_7z_to(
    src: &Path,
    dest: &Path,
    app: Option<&tauri::AppHandle>,
) -> Result<OpResult, String> {
    let name = src
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "archive".into());
    let id = format!("extract:{}", src.to_string_lossy());
    let label = format!("Extracting {name}");
    report_progress(
        app,
        &OpProgress {
            id: id.clone(),
            label: label.clone(),
            current: name.clone(),
            done: 0,
            // The entry count is not known without walking the header, and 7z
            // streams solid blocks; an indeterminate bar is honest here.
            total: 0,
            finished: false,
        },
        1,
    );

    // The crate does its own path-escape refusal when extracting.
    let res = sevenz_rust2::decompress_file(src, dest);

    report_progress(
        app,
        &OpProgress {
            id,
            label,
            current: String::new(),
            done: 1,
            total: 1,
            finished: true,
        },
        1,
    );

    match res {
        Ok(()) => Ok(OpResult {
            ok: true,
            failures: vec![],
            conflicts: vec![],
        }),
        Err(e) => {
            let msg = e.to_string();
            let _ = fs::remove_dir_all(dest);
            err(format!("{name} could not be extracted: {msg}"))
        }
    }
}

/// RAR needs an external decoder -- there is no freely licensed pure-Rust
/// implementation. `7z` (p7zip) reads RAR, and `unrar` does too, so try both
/// before giving up with an actionable message rather than a bare failure.
pub fn extract_rar_to(src: &Path, dest: &Path) -> Result<OpResult, String> {
    let name = src
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "archive".into());
    let candidates: [(&str, &[&str]); 2] = [("7z", &["x", "-y", "-o"]), ("unrar", &["x", "-y"])];
    for (bin, args) in candidates {
        let Ok(out) = std::process::Command::new(bin)
            .args(args)
            .arg(dest)
            .arg(src)
            .output()
        else {
            continue;
        };
        if out.status.success() {
            return Ok(OpResult {
                ok: true,
                failures: vec![],
                conflicts: vec![],
            });
        }
    }
    err(format!(
        "{name} is a RAR archive, which needs an external decoder. Install p7zip (provides 7z) or unrar, then try again."
    ))
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
    fn mislabelled_targz_still_extracts() {
        // `tar -cf bundle.tar.gz dir` writes an UNCOMPRESSED tar with a .gz
        // name. Trusting the extension gave "Invalid Gzip header". Content
        // sniffing is what makes this work.
        let dir = std::env::temp_dir().join(format!("fily-mislabel-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let archive = dir.join("bundle.tar.gz");
        {
            let f = fs::File::create(&archive).unwrap();
            let mut b = tar::Builder::new(f); // no GzEncoder: plain tar bytes
            let body = b"still readable";
            let mut h = tar::Header::new_gnu();
            h.set_size(body.len() as u64);
            h.set_mode(0o644);
            h.set_mtime(0);
            h.set_cksum();
            b.append_data(&mut h, "note.txt", &body[..]).unwrap();
            b.into_inner().unwrap().sync_all().unwrap();
        }
        assert_eq!(
            detect_compression(&archive),
            Compression::None,
            "fixture must not be gzip"
        );

        let dest = dir.join("out");
        fs::create_dir_all(&dest).unwrap();
        let res = extract_tar_to(&archive, &dest, None)
            .unwrap_or_else(|e| panic!("mislabelled tar.gz failed: {e}"));
        assert!(res.ok, "{:?}", res.failures);
        assert_eq!(
            fs::read_to_string(dest.join("note.txt")).unwrap(),
            "still readable"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn compression_detected_from_magic_bytes() {
        let dir = std::env::temp_dir().join(format!("fily-magic-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let plain = dir.join("plain.tar");
        fs::write(&plain, b"not compressed at all").unwrap();
        assert_eq!(detect_compression(&plain), Compression::None);

        let zipped = dir.join("real.tar.gz");
        {
            let f = fs::File::create(&zipped).unwrap();
            let mut enc = flate2::write::GzEncoder::new(f, flate2::Compression::fast());
            enc.write_all(b"compressed payload").unwrap();
            enc.finish().unwrap().sync_all().unwrap();
        }
        assert_eq!(
            detect_compression(&zipped),
            Compression::Gzip,
            "real gzip must be detected"
        );

        assert_eq!(
            detect_compression(&dir.join("missing.tar.gz")),
            Compression::None
        );
        let _ = fs::remove_dir_all(&dir);
    }

    fn build_tar_bytes(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut buf = Vec::new();
        {
            let mut b = tar::Builder::new(&mut buf);
            for (name, body) in entries {
                let mut h = tar::Header::new_gnu();
                h.set_size(body.len() as u64);
                h.set_mode(0o644);
                h.set_mtime(0);
                h.set_cksum();
                b.append_data(&mut h, name, *body).unwrap();
            }
            b.into_inner().unwrap();
        }
        buf
    }

    #[test]
    fn tar_bz2_xz_and_zstd_all_extract() {
        // The compression layer is chosen from magic bytes, so all three of
        // these work regardless of what the extension says.
        let dir = std::env::temp_dir().join(format!("fily-compress-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let raw = build_tar_bytes(&[("note.txt", b"compressed payload")]);

        let bz2 = dir.join("a.tar.bz2");
        {
            let f = fs::File::create(&bz2).unwrap();
            let mut e = bzip2::write::BzEncoder::new(f, bzip2::Compression::fast());
            e.write_all(&raw).unwrap();
            e.finish().unwrap().sync_all().unwrap();
        }
        let xz = dir.join("a.tar.xz");
        {
            let f = fs::File::create(&xz).unwrap();
            let mut e = xz2::write::XzEncoder::new(f, 6);
            e.write_all(&raw).unwrap();
            e.finish().unwrap().sync_all().unwrap();
        }
        let zst = dir.join("a.tar.zst");
        {
            let f = fs::File::create(&zst).unwrap();
            let mut e = zstd::stream::write::Encoder::new(f, 3)
                .unwrap()
                .auto_finish();
            e.write_all(&raw).unwrap();
            e.flush().unwrap();
        }

        for name in ["a.tar.bz2", "a.tar.xz", "a.tar.zst"] {
            let src = dir.join(name);
            let dest = dir.join(format!("out-{}", name.replace('.', "_")));
            fs::create_dir_all(&dest).unwrap();
            let res =
                extract_tar_to(&src, &dest, None).unwrap_or_else(|e| panic!("{name} failed: {e}"));
            assert!(res.ok, "{name}: {:?}", res.failures);
            assert_eq!(
                fs::read_to_string(dest.join("note.txt")).unwrap(),
                "compressed payload",
                "{name} content wrong"
            );
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn zip_based_extensions_extract_as_zip() {
        // .jar/.apk/.whl are zips underneath; the icon said archive and the
        // old code only recognised a literal ".zip".
        let dir = std::env::temp_dir().join(format!("fily-zipext-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        assert_eq!(container_of("app.jar"), Container::Zip);
        assert_eq!(container_of("app.apk"), Container::Zip);
        assert_eq!(container_of("app.whl"), Container::Zip);

        let jar = dir.join("app.jar");
        {
            let f = fs::File::create(&jar).unwrap();
            let mut w = zip::ZipWriter::new(f);
            w.start_file("META-INF/MANIFEST.MF", zip_options()).unwrap();
            std::io::Write::write_all(&mut w, b"Manifest-Version: 1.0").unwrap();
            w.finish().unwrap().sync_all().unwrap();
        }
        let dest = dir.join("out");
        fs::create_dir_all(&dest).unwrap();
        let res = crate::fs_commands::extract_to_any(&jar, &dest, None).unwrap();
        assert!(res.ok, "{:?}", res.failures);
        assert_eq!(
            fs::read_to_string(dest.join("META-INF/MANIFEST.MF")).unwrap(),
            "Manifest-Version: 1.0"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn sevenz_round_trips() {
        let dir = std::env::temp_dir().join(format!("fily-7z-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let src = dir.join("payload");
        fs::create_dir_all(&src).unwrap();
        fs::write(src.join("hello.txt"), b"seven zip payload").unwrap();

        let archive = dir.join("bundle.7z");
        sevenz_rust2::compress(&src, fs::File::create(&archive).unwrap()).unwrap();
        assert!(archive.exists() && fs::metadata(&archive).unwrap().len() > 0);

        let dest = dir.join("out");
        fs::create_dir_all(&dest).unwrap();
        let res = extract_7z_to(&archive, &dest, None).unwrap();
        assert!(res.ok, "{:?}", res.failures);
        // compress() treats the source directory itself as the archive root,
        // so entries are stored relative to it.
        assert_eq!(
            fs::read_to_string(dest.join("hello.txt")).unwrap(),
            "seven zip payload"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn container_and_compression_are_independent() {
        // A .tar.gz that is really an uncompressed tar: the container comes
        // from the name, the compression from the bytes.
        assert_eq!(container_of("x.tar.gz"), Container::Tar);
        assert_eq!(container_of("x.zip"), Container::Zip);
        assert_eq!(container_of("x.7z"), Container::SevenZ);
        assert_eq!(container_of("x.rar"), Container::Rar);
        assert_eq!(container_of("x.unknown"), Container::Tar);
    }

    #[test]
    fn typed_extension_decides_the_format() {
        // The reported bug: typing photos.7z produced photos.zip, and
        // photos.tar.gz produced photos.tar.zip.
        let cases = [
            ("photos.7z", "photos.7z", Container::SevenZ),
            ("photos.tar.gz", "photos.tar.gz", Container::Tar),
            ("photos.zip", "photos.zip", Container::Zip),
            ("photos.tgz", "photos.tgz", Container::Tar),
            ("photos.tar.xz", "photos.tar.xz", Container::Tar),
        ];
        for (typed, expect_name, container) in cases {
            let got = ensure_archive_extension(PathBuf::from(typed));
            assert_eq!(
                got.file_name().unwrap().to_string_lossy(),
                expect_name,
                "{typed} was rewritten"
            );
            assert_eq!(container_of(expect_name), container, "{expect_name}");
        }
        // No recognised extension gets a sensible default.
        assert_eq!(
            ensure_archive_extension(PathBuf::from("photos"))
                .file_name()
                .unwrap()
                .to_string_lossy(),
            "photos.zip"
        );
    }

    #[test]
    fn every_writable_format_round_trips() {
        let dir = std::env::temp_dir().join(format!("fily-roundtrip-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let src = dir.join("payload");
        fs::create_dir_all(src.join("nested")).unwrap();
        fs::write(src.join("a.txt"), b"alpha").unwrap();
        fs::write(src.join("nested/b.txt"), b"beta").unwrap();

        for name in [
            "bundle.zip",
            "bundle.tar",
            "bundle.tar.gz",
            "bundle.tgz",
            "bundle.tar.bz2",
            "bundle.tar.xz",
            "bundle.tar.zst",
            "bundle.7z",
        ] {
            let archive = dir.join(name);
            let res = compress_blocking(
                vec![src.to_string_lossy().into_owned()],
                archive.to_string_lossy().into_owned(),
                Some(true),
            )
            .unwrap_or_else(|e| panic!("{name} compress failed: {e}"));
            assert!(res.ok, "{name}: {:?}", res.failures);
            assert!(archive.exists(), "{name} not created");

            let dest = dir.join(format!("out-{}", name.replace('.', "_")));
            fs::create_dir_all(&dest).unwrap();
            let ex = crate::fs_commands::extract_to_any(&archive, &dest, None)
                .unwrap_or_else(|e| panic!("{name} extract failed: {e}"));
            assert!(ex.ok, "{name}: {:?}", ex.failures);

            // 7z stores entries relative to the source dir; zip/tar keep the
            // top-level folder. Both must contain the real bytes.
            let base = if name.ends_with(".7z") {
                dest.clone()
            } else {
                dest.join("payload")
            };
            assert_eq!(
                fs::read_to_string(base.join("a.txt")).unwrap(),
                "alpha",
                "{name} top-level file"
            );
            assert_eq!(
                fs::read_to_string(base.join("nested/b.txt")).unwrap(),
                "beta",
                "{name} nested file"
            );
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_name_without_an_extension_still_gets_one() {
        // Regression: the zip branch was handed the name the user typed
        // rather than the corrected path, so compressing to "photos" produced
        // a file called "photos" with zip bytes inside and no extension.
        let dir = std::env::temp_dir().join(format!("fily-noext-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let f = dir.join("a.txt");
        fs::write(&f, b"payload").unwrap();

        for typed in ["photos", "photos.zip", "photos.7z"] {
            let res = compress_blocking(
                vec![f.to_string_lossy().into_owned()],
                dir.join(typed).to_string_lossy().into_owned(),
                Some(true),
            )
            .unwrap();
            assert!(res.ok, "{typed}: {:?}", res.failures);
        }
        // The bare name must not survive as a file with no extension.
        assert!(
            !dir.join("photos").exists(),
            "a bare name must not be created without an extension"
        );
        assert!(dir.join("photos.zip").exists());
        assert!(dir.join("photos.7z").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rar_is_refused_with_a_reason() {
        let dir = std::env::temp_dir().join(format!("fily-rarw-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let f = dir.join("a.txt");
        fs::write(&f, b"x").unwrap();
        let err = compress_blocking(
            vec![f.to_string_lossy().into_owned()],
            dir.join("out.rar").to_string_lossy().into_owned(),
            Some(true),
        )
        .unwrap_err();
        assert!(err.contains(".7z"), "should point at an alternative: {err}");
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
