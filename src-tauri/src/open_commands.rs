//! "Open With" support for Fily.
//!
//! Reads freedesktop `.desktop` entries to find applications declaring a
//! MIME type, then launches the chosen one by parsing its `Exec=` line into
//! an argv array — never through a shell.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

use crate::fs_commands::{err, valid_path};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Opener {
    pub id: String,
    pub name: String,
}

struct DesktopApp {
    id: String,
    name: String,
    exec: String,
    mimes: Vec<String>,
}

fn app_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(home) = dirs::home_dir() {
        dirs.push(home.join(".local/share/applications"));
    }
    dirs.push(PathBuf::from("/usr/local/share/applications"));
    dirs.push(PathBuf::from("/usr/share/applications"));
    dirs.into_iter().filter(|d| d.is_dir()).collect()
}

/// Minimal `.desktop` parser: only the keys Fily needs.
fn parse_desktop(id: &str, text: &str) -> Option<DesktopApp> {
    let mut in_entry = false;
    let (mut dtype, mut name, mut exec, mut hidden, mut nodisplay, mut terminal) = (
        String::new(),
        String::new(),
        String::new(),
        false,
        false,
        false,
    );
    let mut mimes: Vec<String> = Vec::new();
    for raw_line in text.lines() {
        let line = raw_line.trim();
        if line.starts_with('[') {
            in_entry = line == "[Desktop Entry]";
            continue;
        }
        if !in_entry || line.is_empty() || line.starts_with('#') {
            continue;
        }
        let (key, value) = line.split_once('=')?;
        match key.trim() {
            "Type" => dtype = value.trim().to_string(),
            "Name" => {
                if name.is_empty() {
                    name = value.trim().to_string();
                }
            }
            "Exec" => {
                if exec.is_empty() {
                    exec = value.trim().to_string();
                }
            }
            "MimeType" => {
                mimes = value
                    .split(';')
                    .map(|s| s.trim().to_lowercase())
                    .filter(|s| !s.is_empty())
                    .collect();
            }
            "NoDisplay" => nodisplay = value.trim().eq_ignore_ascii_case("true"),
            "Hidden" => hidden = value.trim().eq_ignore_ascii_case("true"),
            "Terminal" => terminal = value.trim().eq_ignore_ascii_case("true"),
            _ => {}
        }
    }
    if dtype != "Application" || name.is_empty() || exec.is_empty() {
        return None;
    }
    if hidden || nodisplay || terminal {
        return None;
    }
    Some(DesktopApp {
        id: id.to_string(),
        name,
        exec,
        mimes,
    })
}

fn mime_matches(declared: &[String], mime: &str) -> bool {
    let mime = mime.to_lowercase();
    let major = mime.split('/').next().unwrap_or("");
    declared
        .iter()
        .any(|d| d == &mime || (d.ends_with("/*") && d.trim_end_matches("/*") == major))
}

/// List GUI applications declaring support for `mime`, by display name.
#[tauri::command]
pub fn get_openers(mime: String) -> Result<Vec<Opener>, String> {
    let mime = mime.trim().to_lowercase();
    if mime.is_empty() {
        return err("Unknown file type");
    }
    let mut apps: Vec<DesktopApp> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    // User apps shadow system apps with the same file name.
    for dir in app_dirs() {
        let mut files: Vec<_> = fs::read_dir(&dir)
            .map(|r| r.filter_map(|e| e.ok()).collect())
            .unwrap_or_default();
        files.sort_by_key(|e| e.file_name());
        for entry in files {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !name.ends_with(".desktop") || !seen.insert(name.clone()) {
                continue;
            }
            let text = match fs::read_to_string(entry.path()) {
                Ok(t) => t,
                Err(_) => continue,
            };
            if let Some(app) = parse_desktop(&name, &text) {
                if mime_matches(&app.mimes, &mime) {
                    apps.push(app);
                }
            }
        }
    }
    apps.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    apps.truncate(40);
    Ok(apps
        .into_iter()
        .map(|a| Opener {
            id: a.id,
            name: a.name,
        })
        .collect())
}

/// Tokenize an `Exec=` line per the desktop-entry spec (quotes + backslash
/// escapes), without invoking a shell.
fn split_exec(exec: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut chars = exec.chars().peekable();
    let mut in_single = false;
    let mut in_double = false;
    let mut has_token = false;
    while let Some(c) = chars.next() {
        if in_single {
            if c == '\'' {
                in_single = false;
            } else {
                cur.push(c);
            }
            has_token = true;
        } else if in_double {
            match c {
                '"' => in_double = false,
                '\\' => {
                    if let Some(n) = chars.next() {
                        cur.push(n);
                    }
                    has_token = true;
                }
                _ => {
                    cur.push(c);
                    has_token = true;
                }
            }
        } else {
            match c {
                '\'' => {
                    in_single = true;
                    has_token = true;
                }
                '"' => {
                    in_double = true;
                    has_token = true;
                }
                '\\' => {
                    if let Some(n) = chars.next() {
                        cur.push(n);
                    }
                    has_token = true;
                }
                c if c.is_whitespace() => {
                    if has_token {
                        out.push(std::mem::take(&mut cur));
                        has_token = false;
                    }
                }
                _ => {
                    cur.push(c);
                    has_token = true;
                }
            }
        }
    }
    if has_token {
        out.push(cur);
    }
    out
}

fn file_uri(p: &Path) -> String {
    const UNRESERVED: &[u8] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.~/:";
    let s = p.to_string_lossy();
    let mut out = String::from("file://");
    for b in s.bytes() {
        if UNRESERVED.contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

fn find_desktop(app_id: &str) -> Option<(DesktopApp, PathBuf)> {
    for dir in app_dirs() {
        let candidate = dir.join(app_id);
        if let Ok(text) = fs::read_to_string(&candidate) {
            if let Some(app) = parse_desktop(app_id, &text) {
                return Some((app, candidate));
            }
        }
    }
    None
}

/// Launch `path` with the given `.desktop` application id.
#[tauri::command]
pub fn open_with(path: String, app_id: String) -> Result<(), String> {
    // The id must be a bare file name — no directories, no traversal.
    if app_id.is_empty()
        || app_id.contains('\0')
        || app_id.contains('/')
        || app_id.contains('\\')
        || !app_id.ends_with(".desktop")
    {
        return err("Invalid application");
    }
    let target = valid_path(&path)?;
    let (app, desktop_file) =
        find_desktop(&app_id).ok_or_else(|| "Application not found".to_string())?;

    let uri = file_uri(&target);
    let plain = target.to_string_lossy().into_owned();
    let mut argv = split_exec(&app.exec);
    if argv.is_empty() {
        return err("Application has no launch command");
    }
    let mut expanded: Vec<String> = Vec::with_capacity(argv.len() + 1);
    let mut saw_file = false;
    for tok in argv.drain(..) {
        // A token can mix literals and field codes (`--name=%c`).
        let mut out = String::new();
        let mut tc = tok.chars().peekable();
        while let Some(c) = tc.next() {
            if c == '%' {
                match tc.next() {
                    Some('f') | Some('F') => {
                        out.push_str(&plain);
                        saw_file = true;
                    }
                    Some('u') | Some('U') => {
                        out.push_str(&uri);
                        saw_file = true;
                    }
                    Some('i') => { /* no icon context — drop */ }
                    Some('c') => out.push_str(&app.name),
                    Some('k') => out.push_str(&desktop_file.to_string_lossy()),
                    Some('%') => out.push('%'),
                    // Deprecated codes (%d %D %n %N %v %m) expand to empty.
                    Some(_) => {}
                    None => out.push('%'),
                }
            } else {
                out.push(c);
            }
        }
        if !out.is_empty() {
            expanded.push(out);
        }
    }
    if !saw_file {
        expanded.push(plain);
    }
    let (bin, args) = expanded.split_first().unwrap();
    std::process::Command::new(bin)
        .args(args)
        .current_dir(target.parent().unwrap_or(Path::new("/")))
        .spawn()
        .map_err(|e| format!("Cannot launch {}: {e}", app.name))?;
    Ok(())
}
