mod archive_commands;
mod cli;
mod fs_commands;
mod logic;
mod open_commands;
mod settings;

use settings::FilySettings;
use tauri::{Emitter, Manager};

/// IPC: hand the current settings to the front end.
#[tauri::command]
fn get_settings() -> (FilySettings, bool) {
    (settings::load(), settings::exists())
}

/// IPC: merge a partial patch (used by the in-app Settings modal).
#[tauri::command]
fn set_settings(patch: serde_json::Value) -> Result<FilySettings, String> {
    settings::apply_patch(&patch)
}

/// IPC: restore defaults (used by "Reset all settings").
#[tauri::command]
fn reset_settings() -> Result<FilySettings, String> {
    settings::reset()
}

/// Poll the settings file and push changes to the window so an external write
/// (`fily config set …`, or an AI editing the file) applies live.
///
/// Backs off when nothing changes: a steady 400 ms poll means two `stat` calls a
/// second forever for an app that is usually idle. After `IDLE_TICKS` quiet
/// checks it stretches out to 2 s and only tightens again once the file moves.
fn spawn_settings_watcher(app: tauri::AppHandle) {
    const BUSY_MS: u64 = 400;
    const IDLE_MS: u64 = 2_000;
    const IDLE_TICKS: u32 = 5;
    std::thread::spawn(move || {
        let mut last = settings::fingerprint();
        let mut quiet = 0u32;
        loop {
            let mut wait = if quiet >= IDLE_TICKS {
                IDLE_MS
            } else {
                BUSY_MS
            };
            // Break the sleep into slices so a change is still noticed promptly
            // even while idling, without busy-waiting the rest of the time.
            let deadline = std::time::Instant::now() + std::time::Duration::from_millis(wait);
            while std::time::Instant::now() < deadline {
                std::thread::sleep(std::time::Duration::from_millis(wait / 10));
                wait = (deadline - std::time::Instant::now()).as_millis().max(1) as u64;
                if settings::fingerprint() != last {
                    break;
                }
            }
            let now = settings::fingerprint();
            if now != last {
                last = now;
                quiet = 0;
                let _ = app.emit("settings-changed", settings::load());
            } else {
                quiet = quiet.saturating_add(1);
            }
        }
    });
}

fn main() {
    // CLI first: a config command must never open a window.
    let args: Vec<String> = std::env::args().skip(1).collect();
    if let Some(code) = cli::run(&args) {
        std::process::exit(code);
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            fs_commands::list_dir,
            fs_commands::stat_path,
            fs_commands::create_dir,
            fs_commands::create_file,
            fs_commands::rename_path,
            fs_commands::copy_paths,
            fs_commands::move_paths,
            fs_commands::duplicate_path,
            fs_commands::trash_paths,
            fs_commands::delete_permanent,
            fs_commands::search_dir,
            fs_commands::read_text_preview,
            fs_commands::read_image_data_url,
            fs_commands::list_archive,
            fs_commands::file_checksum,
            fs_commands::dir_size,
            fs_commands::open_path,
            fs_commands::open_terminal,
            fs_commands::get_places,
            fs_commands::get_volumes,
            fs_commands::extract_archive,
            archive_commands::compress_zip,
            archive_commands::extract_here,
            open_commands::get_openers,
            open_commands::open_with,
            get_settings,
            set_settings,
            reset_settings,
        ])
        .setup(|app| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.set_title("Fily");
            }
            spawn_settings_watcher(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Fily");
}
