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
fn spawn_settings_watcher(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let mut last = settings::fingerprint();
        loop {
            std::thread::sleep(std::time::Duration::from_millis(400));
            let now = settings::fingerprint();
            if now != last {
                last = now;
                let _ = app.emit("settings-changed", settings::load());
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
