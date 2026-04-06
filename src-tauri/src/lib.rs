mod ai_settings;
mod braian_store;
mod db;
mod workspace;
mod workspace_agent;
mod workspace_files;
mod workspace_mcp_config;
mod workspace_mcp_http;
mod workspace_mcp_runtime;
mod workspace_mcp_stdio;
mod workspace_mcp_probe;
mod workspace_git;
mod workspace_webapp_dev;
mod workspace_webapp_static;
mod workspace_hub;

use tauri::Manager;

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
      app.manage(workspace_webapp_dev::WebappDevState::default());
      app.manage(workspace_webapp_static::WebappStaticServerState::start(
        app.handle().clone(),
      ));
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
      workspace_git::workspace_git_status,
      workspace_git::workspace_git_set_enabled,
      workspace_git::workspace_git_ensure,
      workspace_git::workspace_git_list_checkpoints,
      workspace_git::workspace_git_try_commit,
      workspace_git::workspace_git_restore_full,
      workspace_files::workspace_read_text_file,
      workspace_files::workspace_write_text_file,
      workspace_files::workspace_import_file,
      workspace_files::workspace_list_dir,
      workspace_files::workspace_list_all_files,
      workspace_files::workspace_search_text,
      workspace_agent::workspace_run_command,
      workspace_agent::workspace_run_shell,
      braian_store::conversation_list,
      braian_store::conversation_create,
      braian_store::conversation_open,
      braian_store::conversation_save,
      braian_store::conversation_set_title,
      braian_store::conversation_set_pinned,
      braian_store::conversation_set_unread,
      braian_store::conversation_delete,
      braian_store::canvas_document_write,
      ai_settings::ai_settings_get,
      ai_settings::ai_settings_set,
      workspace_mcp_config::workspace_mcp_config_get,
      workspace_mcp_config::workspace_mcp_config_set,
      workspace_mcp_probe::workspace_mcp_probe_connection,
      workspace_mcp_runtime::workspace_mcp_list_tools,
      workspace_mcp_runtime::workspace_mcp_call_tool,
      workspace_mcp_runtime::workspace_mcp_sessions_disconnect,
      workspace_webapp_dev::webapp_dev_start,
      workspace_webapp_dev::webapp_dev_stop,
      workspace_webapp_dev::webapp_dev_status,
      workspace_webapp_dev::webapp_dev_logs,
      workspace_webapp_dev::webapp_preview_path_set,
      workspace_webapp_dev::webapp_init_from_template,
      workspace_webapp_static::webapp_static_server_url,
      workspace_webapp_static::webapp_publish,
      workspace_webapp_static::webapp_publish_status,
      workspace_hub::workspace_hub_snapshot,
      workspace_hub::workspace_hub_recent_file_touch,
    ])
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|app_handle, event| {
      if let tauri::RunEvent::Exit = event {
        workspace_webapp_dev::webapp_dev_stop_all(&app_handle);
      }
    });
}
