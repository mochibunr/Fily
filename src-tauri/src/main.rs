mod archive_commands;
mod fs_commands;
mod logic;
mod open_commands;

use tauri::Manager;

fn main() {
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
        ])
        .setup(|app| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.set_title("Fily");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Fily");
}
