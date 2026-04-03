use rusqlite::Connection;
use tauri::Manager;

fn init_local_db(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
  let dir = app.path().app_data_dir()?;
  std::fs::create_dir_all(&dir)?;
  let db_path = dir.join("braian.db");
  let conn = Connection::open(&db_path)?;
  conn.execute_batch(
    "CREATE TABLE IF NOT EXISTS _schema_version (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      version INTEGER NOT NULL DEFAULT 0
    );
    INSERT OR IGNORE INTO _schema_version (id, version) VALUES (1, 0);",
  )?;
  let check: i32 = conn.query_row("SELECT 1", [], |row| row.get(0))?;
  log::info!("SQLite OK at {:?} (check={})", db_path, check);
  Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      if let Err(e) = init_local_db(app) {
        log::error!("Failed to initialize SQLite: {e}");
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
