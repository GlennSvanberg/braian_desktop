mod ai_settings;
mod braian_store;
mod db;
mod workspace;
mod workspace_agent;
mod workspace_files;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_window_state::Builder::default().build())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_opener::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      if let Err(e) = db::init(app.handle()) {
        log::error!("Failed to initialize SQLite: {e}");
      }
      if let Err(e) = workspace::ensure_default_workspace(app.handle()) {
        log::error!("Failed to ensure default workspace: {e}");
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      workspace::workspace_list,
      workspace::workspace_get_default_root,
      workspace::workspace_create,
      workspace::workspace_add_from_path,
      workspace::workspace_remove,
      workspace::workspace_rename,
      workspace::workspace_touch,
      workspace_files::workspace_read_text_file,
      workspace_files::workspace_write_text_file,
      workspace_files::workspace_import_file,
      workspace_files::workspace_list_dir,
      workspace_files::workspace_list_all_files,
      workspace_agent::workspace_run_command,
      braian_store::conversation_list,
      braian_store::conversation_create,
      braian_store::conversation_open,
      braian_store::conversation_save,
      braian_store::conversation_set_title,
      braian_store::conversation_delete,
      braian_store::canvas_document_write,
      ai_settings::ai_settings_get,
      ai_settings::ai_settings_set,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
