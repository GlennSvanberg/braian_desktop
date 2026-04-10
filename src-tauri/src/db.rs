use rusqlite::Connection;
use tauri::{AppHandle, Manager};

pub fn db_path(app: &AppHandle) -> Result<std::path::PathBuf, Box<dyn std::error::Error>> {
  let dir = app.path().app_data_dir()?;
  Ok(dir.join("braian.db"))
}

pub fn open_connection(app: &AppHandle) -> Result<Connection, rusqlite::Error> {
  let path = db_path(app).map_err(|_| {
    rusqlite::Error::InvalidPath(std::path::PathBuf::from("invalid app data path"))
  })?;
  if let Some(parent) = path.parent() {
    let _ = std::fs::create_dir_all(parent);
  }
  let conn = Connection::open(&path)?;
  conn.execute_batch("PRAGMA foreign_keys = ON;")?;
  migrate(&conn)?;
  Ok(conn)
}

fn migrate(conn: &Connection) -> Result<(), rusqlite::Error> {
  conn.execute_batch(
    "CREATE TABLE IF NOT EXISTS _schema_version (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      version INTEGER NOT NULL DEFAULT 0
    );
    INSERT OR IGNORE INTO _schema_version (id, version) VALUES (1, 0);",
  )?;

  let version: i32 =
    conn.query_row("SELECT version FROM _schema_version WHERE id = 1", [], |row| {
      row.get(0)
    })?;

  if version < 1 {
    conn.execute_batch(
      "CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        root_path TEXT NOT NULL UNIQUE,
        created_at_ms INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY NOT NULL,
        workspace_id TEXT NOT NULL,
        title TEXT NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        canvas_kind TEXT NOT NULL DEFAULT 'document',
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_conversations_workspace
        ON conversations(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_conversations_updated
        ON conversations(workspace_id, updated_at_ms DESC);
      UPDATE _schema_version SET version = 1 WHERE id = 1;",
    )?;
  }

  if version < 2 {
    conn.execute_batch(
      "CREATE TABLE IF NOT EXISTS ai_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        provider TEXT NOT NULL DEFAULT 'openai',
        api_key TEXT NOT NULL DEFAULT '',
        model_id TEXT NOT NULL DEFAULT '',
        base_url TEXT
      );
      UPDATE _schema_version SET version = 2 WHERE id = 1;",
    )?;
  }

  if version < 3 {
    conn.execute_batch(
      "DROP TABLE IF EXISTS conversations;
      UPDATE _schema_version SET version = 3 WHERE id = 1;",
    )?;
  }

  if version < 4 {
    conn.execute_batch(
      "ALTER TABLE workspaces ADD COLUMN last_used_at_ms INTEGER NOT NULL DEFAULT 0;
      UPDATE workspaces SET last_used_at_ms = created_at_ms WHERE last_used_at_ms = 0;
      UPDATE _schema_version SET version = 4 WHERE id = 1;",
    )?;
  }

  if version < 5 {
    conn.execute_batch(
      "ALTER TABLE workspaces ADD COLUMN webapp_preview_path TEXT NOT NULL DEFAULT '/';
      UPDATE _schema_version SET version = 5 WHERE id = 1;",
    )?;
  }

  if version < 6 {
    conn.execute_batch(
      "ALTER TABLE workspaces ADD COLUMN webapp_published_at_ms INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE workspaces ADD COLUMN webapp_publish_fingerprint TEXT NOT NULL DEFAULT '';
      UPDATE _schema_version SET version = 6 WHERE id = 1;",
    )?;
  }

  if version < 7 {
    conn.execute_batch(
      "ALTER TABLE ai_settings ADD COLUMN context_max_history_tokens INTEGER NOT NULL DEFAULT 65536;
      UPDATE _schema_version SET version = 7 WHERE id = 1;",
    )?;
  }

  if version < 8 {
    conn.execute_batch(
      "CREATE TABLE IF NOT EXISTS memory_entries (
        workspace_id TEXT NOT NULL,
        entry_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        summary TEXT NOT NULL,
        status TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, entry_id)
      );
      CREATE INDEX IF NOT EXISTS idx_memory_entries_workspace
        ON memory_entries(workspace_id, updated_at_ms DESC);
      UPDATE _schema_version SET version = 8 WHERE id = 1;",
    )?;
  }

  Ok(())
}

pub fn init(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
  let conn = open_connection(app)?;
  let check: i32 = conn.query_row("SELECT 1", [], |row| row.get(0))?;
  log::info!("SQLite OK (check={})", check);
  Ok(())
}
