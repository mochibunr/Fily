//! Command-line interface for configuring Fily without launching the GUI.
//!
//! Runs before the Tauri builder, so `fily config set theme=nord` completes in
//! milliseconds and never opens a window. If the app is already running, a
//! background watcher picks the change up and applies it live.
//!
//! ```text
//! fily config list                 show every setting and its current value
//! fily config get <key>            read one value as JSON
//! fily config set k=v [k=v ...]    change values (validated and clamped)
//! fily config reset                restore defaults
//! ```

use super::settings::{self, FilySettings, KEYS};
use serde_json::{json, Map, Value};

const USAGE: &str = "\
Fily — a modern desktop file manager

USAGE:
    fily [PATH]                 open the app, optionally at PATH
    fily config <SUBCOMMAND>    read or write settings without the GUI

CONFIG:
    list                        print all settings and their current values
    get <KEY>                   print one value as JSON
    set <KEY>=<VALUE>...        set one or more values
    reset                       restore all defaults
    path                        print the settings file location

SETTINGS:
    theme                       one of: light, dark, dracula, catppuccin-mocha,
                                catppuccin-latte, nord, gruvbox, tokyo-night,
                                one-dark
    uiZoom                      whole-app scale, 0.7 to 1.6
    listScale                   file list text/icon scale, 0.8 to 1.6
    showHidden                  true | false
    sideWidth                   sidebar width in px, 160 to 400
    sidebarCollapsed            true | false
    showDevices                 true | false
    showPlaces                  true | false
    toolbar                     JSON object, e.g. '{\"terminal\":false}'

EXAMPLES:
    fily config set theme=nord
    fily config set uiZoom=1.2 listScale=1.15
    fily config set toolbar='{\"newFolder\":true,\"terminal\":false}'
";

/// Handle a CLI invocation. Returns `Some(exit_code)` when the arguments were a
/// CLI command, or `None` when the app should start normally.
pub fn run(args: &[String]) -> Option<i32> {
    let first = args.first()?.as_str();
    match first {
        "-h" | "--help" | "help" => {
            print!("{USAGE}");
            Some(0)
        }
        "-V" | "--version" | "version" => {
            println!("fily {}", env!("CARGO_PKG_VERSION"));
            Some(0)
        }
        "config" => Some(config(&args[1..])),
        _ => None,
    }
}

fn config(args: &[String]) -> i32 {
    match args.first().map(|s| s.as_str()) {
        Some("list") | None => match settings::load() {
            s => {
                println!("{}", render(&s));
                0
            }
        },
        Some("path") => {
            println!("{}", settings::describe_location());
            0
        }
        Some("get") => match args.get(1) {
            None => {
                eprintln!("error: 'config get' needs a key\n\n{}", key_help());
                2
            }
            Some(key) => {
                let s = settings::load();
                match to_value(&s).get(key) {
                    Some(v) => {
                        println!("{}", render_value(v));
                        0
                    }
                    None => {
                        eprintln!("error: unknown setting '{key}'\n\n{}", key_help());
                        2
                    }
                }
            }
        },
        Some("set") => {
            if args.len() < 2 {
                eprintln!("error: 'config set' needs KEY=VALUE, e.g. theme=nord");
                return 2;
            }
            let mut patch = Map::new();
            for pair in &args[1..] {
                let Some((k, v)) = pair.split_once('=') else {
                    eprintln!("error: '{pair}' is not KEY=VALUE");
                    return 2;
                };
                let k = k.trim();
                if !KEYS.contains(&k) {
                    eprintln!("error: unknown setting '{k}'\n\n{}", key_help());
                    return 2;
                }
                patch.insert(k.to_string(), coerce(k, v));
            }
            match settings::apply_patch(&Value::Object(patch)) {
                Ok(s) => {
                    println!("{}", render(&s));
                    0
                }
                Err(e) => {
                    eprintln!("error: {e}");
                    1
                }
            }
        }
        Some("reset") => match settings::reset() {
            Ok(s) => {
                println!(
                    "{}reset to defaults\n{}",
                    render(&s),
                    settings::describe_location()
                );
                0
            }
            Err(e) => {
                eprintln!("error: {e}");
                1
            }
        },
        Some(other) => {
            eprintln!("error: unknown subcommand 'config {other}'\n\n{USAGE}");
            2
        }
    }
}

fn key_help() -> String {
    format!("known settings: {}", KEYS.join(", "))
}

/// Type a CLI string according to the target key.
///
/// Key-aware rather than "guess from the literal": a theme named `2077` must
/// stay a string, and a bad number is passed through as a string so the backend
/// reports `uiZoom must be a number` instead of a confusing type error.
fn coerce(key: &str, raw: &str) -> Value {
    match key {
        "theme" => Value::String(raw.to_string()),
        "uiZoom" | "listScale" | "sideWidth" => match raw.parse::<f64>() {
            Ok(n) => json!(n),
            Err(_) => Value::String(raw.to_string()),
        },
        "showHidden" | "sidebarCollapsed" | "showDevices" | "showPlaces" => match raw {
            "true" => Value::Bool(true),
            "false" => Value::Bool(false),
            other => Value::String(other.to_string()),
        },
        "toolbar" => {
            serde_json::from_str::<Value>(raw).unwrap_or_else(|_| Value::String(raw.to_string()))
        }
        _ => Value::String(raw.to_string()),
    }
}

fn to_value(s: &FilySettings) -> Map<String, Value> {
    match serde_json::to_value(s) {
        Ok(Value::Object(m)) => m,
        _ => Map::new(),
    }
}

fn render_value(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

fn render(s: &FilySettings) -> String {
    let m = to_value(s);
    let mut out = String::new();
    for k in KEYS {
        if let Some(v) = m.get(k) {
            out.push_str(&format!("{k} = {}\n", render_value(v)));
        }
    }
    out.push_str(&format!("\n# {}\n", settings::describe_location()));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn coerce_types_values() {
        assert_eq!(coerce("theme", "nord"), Value::String("nord".into()));
        assert_eq!(coerce("showHidden", "true"), Value::Bool(true));
        assert_eq!(coerce("uiZoom", "1.25"), json!(1.25));
        assert_eq!(coerce("sideWidth", "300"), json!(300.0));
        assert_eq!(
            coerce("toolbar", "{\"terminal\":false}"),
            json!({"terminal": false})
        );
    }

    #[test]
    fn numeric_looking_theme_stays_a_string() {
        // A theme must never be coerced to a number, or the backend error
        // becomes confusing.
        assert_eq!(coerce("theme", "2077"), Value::String("2077".into()));
    }

    #[test]
    fn bad_numbers_pass_through_for_a_clear_error() {
        // Passed as a string so the backend says "must be a number".
        assert_eq!(coerce("uiZoom", "big"), Value::String("big".into()));
        assert_eq!(coerce("showHidden", "yes"), Value::String("yes".into()));
    }
}
