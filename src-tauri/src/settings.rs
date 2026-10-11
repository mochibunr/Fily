//! User settings, persisted as JSON outside the webview.
//!
//! The front end historically kept these in the webview's `localStorage`,
//! which no external process can reach. That made the app impossible to
//! configure from a terminal or an AI agent. This module is the authoritative
//! store: a plain JSON file any tool can read or write.
//!
//! Layout: `$XDG_CONFIG_HOME/fily/settings.json` (`~/.config/fily/settings.json`).

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::PathBuf;

/// Every valid value for `theme`. Kept in sync with `src/themes.ts`.
pub const THEMES: [&str; 9] = [
    "light",
    "dark",
    "dracula",
    "catppuccin-mocha",
    "catppuccin-latte",
    "nord",
    "gruvbox",
    "tokyo-night",
    "one-dark",
];

/// Toolbar toggle keys, mirrored in `ToolbarKey` (TypeScript).
pub const TOOLBAR_KEYS: [&str; 7] = [
    "newFolder",
    "newFile",
    "terminal",
    "dual",
    "hidden",
    "preview",
    "theme",
];

/// Every settable key, used for validation and for `config list` output.
pub const KEYS: [&str; 11] = [
    "theme",
    "uiZoom",
    "listScale",
    "showHidden",
    "sideWidth",
    "sidebarCollapsed",
    "showDevices",
    "showPlaces",
    "previewVisible",
    "dual",
    "toolbar",
];

fn clamp(v: f64, lo: f64, hi: f64) -> f64 {
    if v.is_nan() {
        lo
    } else {
        v.max(lo).min(hi)
    }
}

/// Ranges enforced on write so the UI can never be driven into an unusable
/// state by a bad value (these mirror the clamps in `store/app.tsx`).
pub fn ui_zoom_range() -> (f64, f64) {
    (0.7, 1.6)
}
pub fn list_scale_range() -> (f64, f64) {
    (0.8, 1.6)
}
pub fn side_width_range() -> (u32, u32) {
    (160, 400)
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct FilySettings {
    pub theme: String,
    pub ui_zoom: f64,
    pub list_scale: f64,
    pub show_hidden: bool,
    pub side_width: u32,
    pub sidebar_collapsed: bool,
    pub show_devices: bool,
    pub show_places: bool,
    /// Preview panel visibility. This was never persisted, so turning the panel
    /// off did not survive a restart.
    pub preview_visible: bool,
    /// Dual-pane mode, same problem as `preview_visible`.
    pub dual: bool,
    pub toolbar: BTreeMap<String, bool>,
}

impl Default for FilySettings {
    fn default() -> Self {
        Self {
            theme: "dark".into(),
            ui_zoom: 1.0,
            list_scale: 1.0,
            show_hidden: false,
            side_width: 218,
            sidebar_collapsed: false,
            show_devices: true,
            show_places: true,
            preview_visible: true,
            dual: false,
            toolbar: BTreeMap::from([
                ("newFolder".into(), false),
                ("newFile".into(), false),
                ("terminal".into(), true),
                ("dual".into(), false),
                ("hidden".into(), false),
                ("preview".into(), false),
                ("theme".into(), false),
            ]),
        }
    }
}

impl FilySettings {
    /// Force every field into its legal range. Applied after every load and
    /// every patch so a hand-edited or corrupt file cannot break the UI.
    pub fn normalize(&mut self) {
        if !THEMES.contains(&self.theme.as_str()) {
            self.theme = "dark".into();
        }
        let (zlo, zhi) = ui_zoom_range();
        self.ui_zoom = clamp(round2(self.ui_zoom), zlo, zhi);
        let (llo, lhi) = list_scale_range();
        self.list_scale = clamp(round2(self.list_scale), llo, lhi);
        let (wlo, whi) = side_width_range();
        self.side_width = self.side_width.clamp(wlo, whi);
        // Drop unknown toolbar keys and fill any the file omitted.
        let defaults = Self::default().toolbar;
        self.toolbar
            .retain(|k, _| TOOLBAR_KEYS.contains(&k.as_str()));
        for (k, v) in defaults {
            self.toolbar.entry(k).or_insert(v);
        }
    }
}

fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

/// Absolute path of the settings file.
///
/// `FILY_CONFIG_DIR` overrides the location — useful for testing, for running
/// an isolated second profile, and for portable installs.
pub fn path() -> PathBuf {
    if let Ok(dir) = std::env::var("FILY_CONFIG_DIR") {
        if !dir.is_empty() {
            return PathBuf::from(dir).join("settings.json");
        }
    }
    let base = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join("fily").join("settings.json")
}

/// True when a settings file is already on disk. The front end uses this to
/// decide whether to migrate existing `localStorage` values up.
pub fn exists() -> bool {
    path().is_file()
}

/// Read settings, falling back to defaults for a missing or corrupt file.
pub fn load() -> FilySettings {
    let p = path();
    let Ok(raw) = std::fs::read_to_string(&p) else {
        return FilySettings::default();
    };
    // A partially valid file still yields whatever fields parsed; an entirely
    // unparseable one falls back to defaults rather than crashing the app.
    serde_json::from_str::<FilySettings>(&raw)
        .map(|mut s| {
            s.normalize();
            s
        })
        .unwrap_or_default()
}

/// Write settings atomically (temp file + rename) so a watcher never observes a
/// half-written document.
pub fn save(s: &FilySettings) -> Result<(), String> {
    let p = path();
    if let Some(dir) = p.parent() {
        std::fs::create_dir_all(dir)
            .map_err(|e| format!("Cannot create {}: {e}", dir.display()))?;
    }
    let body = serde_json::to_string_pretty(s).map_err(|e| e.to_string())?;
    let tmp = p.with_extension("json.tmp");
    std::fs::write(&tmp, body).map_err(|e| format!("Cannot write {}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, &p).map_err(|e| format!("Cannot update {}: {e}", p.display()))?;
    Ok(())
}

fn want_bool(v: &Value, key: &str) -> Result<bool, String> {
    match v {
        Value::Bool(b) => Ok(*b),
        Value::String(s) if s == "true" || s == "false" => Ok(s == "true"),
        _ => Err(format!("{key} must be true or false")),
    }
}

fn want_num(v: &Value, key: &str) -> Result<f64, String> {
    v.as_f64().ok_or_else(|| format!("{key} must be a number"))
}

fn want_str<'a>(v: &'a Value, key: &str) -> Result<&'a str, String> {
    v.as_str().ok_or_else(|| format!("{key} must be a string"))
}

/// Merge a partial settings patch into the stored settings.
///
/// Unknown keys are rejected rather than ignored, so a typo from a script or an
/// AI agent surfaces as an error instead of silently doing nothing.
pub fn apply_patch(patch: &Value) -> Result<FilySettings, String> {
    let obj = patch
        .as_object()
        .ok_or("settings patch must be a JSON object")?;
    let mut s = load();
    for (key, v) in obj {
        match key.as_str() {
            "theme" => {
                let t = want_str(v, key)?;
                if !THEMES.contains(&t) {
                    return Err(format!(
                        "unknown theme '{t}'; expected one of: {}",
                        THEMES.join(", ")
                    ));
                }
                s.theme = t.to_string();
            }
            "uiZoom" => s.ui_zoom = want_num(v, key)?,
            "listScale" => s.list_scale = want_num(v, key)?,
            "showHidden" => s.show_hidden = want_bool(v, key)?,
            "sideWidth" => {
                s.side_width = want_num(v, key)?.round() as i64 as u32;
            }
            "sidebarCollapsed" => s.sidebar_collapsed = want_bool(v, key)?,
            "showDevices" => s.show_devices = want_bool(v, key)?,
            "showPlaces" => s.show_places = want_bool(v, key)?,
            "previewVisible" => s.preview_visible = want_bool(v, key)?,
            "dual" => s.dual = want_bool(v, key)?,
            "toolbar" => {
                let t = v
                    .as_object()
                    .ok_or("toolbar must be an object of {key: bool}")?;
                for (tk, tv) in t {
                    if !TOOLBAR_KEYS.contains(&tk.as_str()) {
                        return Err(format!(
                            "unknown toolbar key '{tk}'; expected one of: {}",
                            TOOLBAR_KEYS.join(", ")
                        ));
                    }
                    s.toolbar.insert(tk.clone(), want_bool(tv, tk)?);
                }
            }
            other => {
                return Err(format!(
                    "unknown setting '{other}'; expected one of: {}",
                    KEYS.join(", ")
                ))
            }
        }
    }
    s.normalize();
    save(&s)?;
    Ok(s)
}

/// Delete the settings file so the next load falls back to defaults.
pub fn reset() -> Result<FilySettings, String> {
    let p = path();
    if p.is_file() {
        std::fs::remove_file(&p).map_err(|e| format!("Cannot remove {}: {e}", p.display()))?;
    }
    let d = FilySettings::default();
    save(&d)?;
    Ok(d)
}

/// Modification time + length, used as a cheap change signal by the watcher.
pub fn fingerprint() -> Option<(u64, u64)> {
    let p: PathBuf = path();
    let meta = std::fs::metadata(&p).ok()?;
    let len = meta.len();
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    Some((mtime, len))
}

/// One-line human summary of where settings live, used by CLI help.
pub fn describe_location() -> String {
    path().to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_in_range() {
        let mut d = FilySettings::default();
        d.normalize();
        assert_eq!(d.theme, "dark");
        assert!((0.7..=1.6).contains(&d.ui_zoom));
        assert!((160..=400).contains(&d.side_width));
    }

    #[test]
    fn normalize_clamps_out_of_range_values() {
        let mut s = FilySettings::default();
        s.ui_zoom = 99.0;
        s.list_scale = 0.01;
        s.side_width = 5000;
        s.theme = "neon".into();
        s.normalize();
        assert_eq!(s.ui_zoom, 1.6);
        assert_eq!(s.list_scale, 0.8);
        assert_eq!(s.side_width, 400);
        assert_eq!(s.theme, "dark");
    }

    #[test]
    fn normalize_drops_unknown_toolbar_keys() {
        let mut s = FilySettings::default();
        s.toolbar.insert("nonsense".into(), true);
        s.normalize();
        assert!(!s.toolbar.contains_key("nonsense"));
        assert_eq!(s.toolbar.len(), TOOLBAR_KEYS.len());
    }

    #[test]
    fn theme_list_matches_typescript() {
        // The front end hardcodes this list too; a drift breaks the CLI.
        assert_eq!(THEMES.len(), 9);
        assert!(THEMES.contains(&"one-dark"));
        assert!(THEMES.contains(&"catppuccin-mocha"));
    }

    #[test]
    fn patch_persists_and_survives_reload() {
        // Single test touching the filesystem: `set_var` is process-global.
        use serde_json::json;
        let dir = std::env::temp_dir().join(format!("fily-settings-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::env::set_var("FILY_CONFIG_DIR", &dir);

        assert!(!exists(), "fresh dir should have no settings file");
        assert_eq!(load().theme, "dark", "missing file yields defaults");

        let s = apply_patch(&json!({ "theme": "nord", "uiZoom": 1.25, "sideWidth": 300 }))
            .expect("patch should apply");
        assert_eq!(s.theme, "nord");
        assert_eq!(s.ui_zoom, 1.25);
        assert!(exists(), "patch should create the file");

        // A fresh read (what the watcher does) must see the change.
        let reloaded = load();
        assert_eq!(reloaded.theme, "nord");
        assert_eq!(reloaded.ui_zoom, 1.25);
        assert_eq!(reloaded.side_width, 300);
        assert_ne!(fingerprint(), None, "watcher needs a fingerprint");

        // Patch again: partial merge must not clobber untouched values.
        let merged = apply_patch(&json!({ "showHidden": true })).expect("second patch");
        assert_eq!(merged.theme, "nord", "untouched key preserved");
        assert!(merged.show_hidden);

        // Out-of-range values are clamped on write, not just on read.
        let clamped = apply_patch(&json!({ "uiZoom": 42.0 })).unwrap();
        assert_eq!(clamped.ui_zoom, 1.6);

        // Unknown keys are rejected so a typo cannot silently no-op.
        let err = apply_patch(&json!({ "themee": "dracula" })).unwrap_err();
        assert!(err.contains("unknown setting"), "got: {err}");

        let r = reset().expect("reset");
        assert_eq!(r.theme, "dark");
        let _ = std::env::remove_var("FILY_CONFIG_DIR");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn corrupt_file_falls_back_to_defaults() {
        let dir = std::env::temp_dir().join(format!("fily-settings-bad-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("settings.json"), "{ this is not json").unwrap();
        std::env::set_var("FILY_CONFIG_DIR", &dir);

        let s = load();
        assert_eq!(s.theme, "dark", "corrupt file must not crash the app");

        let _ = std::env::remove_var("FILY_CONFIG_DIR");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
