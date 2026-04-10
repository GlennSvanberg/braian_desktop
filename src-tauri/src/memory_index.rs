use std::fs;
use std::path::PathBuf;

use rusqlite::params;
use serde::Deserialize;
use tauri::AppHandle;

use crate::braian_store::workspace_root_path;
use crate::db;

#[derive(Debug, Deserialize)]
struct MemoryFileMinimal {
  id: String,
  kind: String,
  summary: String,
  status: String,
}

#[tauri::command]
pub fn memory_index_upsert(
  app: AppHandle,
  workspace_id: String,
  entry_id: String,
  kind: String,
  summary: String,
  status: String,
  relative_path: String,
  updated_at_ms: i64,
) -> Result<(), String> {
  let conn = db::open_connection(&app).map_err(|e| e.to_string())?;
  conn
    .execute(
      "INSERT INTO memory_entries (workspace_id, entry_id, kind, summary, status, relative_path, updated_at_ms)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(workspace_id, entry_id) DO UPDATE SET
         kind = excluded.kind,
         summary = excluded.summary,
         status = excluded.status,
         relative_path = excluded.relative_path,
         updated_at_ms = excluded.updated_at_ms",
      params![
        workspace_id,
        entry_id,
        kind,
        summary,
        status,
        relative_path,
        updated_at_ms
      ],
    )
    .map_err(|e| e.to_string())?;
  Ok(())
}

fn collect_json_under(
  dir: &std::path::Path,
  rel_prefix: &str,
  out: &mut Vec<(String, PathBuf)>,
) -> Result<(), String> {
  if !dir.is_dir() {
    return Ok(());
  }
  for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
    let entry = entry.map_err(|e| e.to_string())?;
    let name = entry.file_name().to_string_lossy().to_string();
    if name == "." || name == ".." {
      continue;
    }
    let path = entry.path();
    let rel = if rel_prefix.is_empty() {
      name.clone()
    } else {
      format!("{rel_prefix}/{name}")
    };
    if path.is_dir() {
      if name == "_suggestions" {
        continue;
      }
      collect_json_under(&path, &rel, out)?;
    } else if name.ends_with(".json") {
      let rel_path = rel.replace('\\', "/");
      out.push((rel_path, path));
    }
  }
  Ok(())
}

#[tauri::command]
pub fn memory_index_rebuild_workspace(
  app: AppHandle,
  workspace_id: String,
) -> Result<(), String> {
  let conn = db::open_connection(&app).map_err(|e| e.to_string())?;
  let root = workspace_root_path(&conn, &workspace_id)?;
  let memory_root = root.join(".braian").join("memory");
  if !memory_root.is_dir() {
    conn
      .execute(
        "DELETE FROM memory_entries WHERE workspace_id = ?1",
        params![workspace_id],
      )
      .map_err(|e| e.to_string())?;
    return Ok(());
  }

  let mut files: Vec<(String, PathBuf)> = Vec::new();
  for sub in &["facts", "decisions", "preferences", "episodes", "patterns"] {
    let d = memory_root.join(sub);
    collect_json_under(&d, &format!(".braian/memory/{sub}"), &mut files)?;
  }

  let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
  tx.execute(
    "DELETE FROM memory_entries WHERE workspace_id = ?1",
    params![workspace_id],
  )
  .map_err(|e| e.to_string())?;

  for (rel_path, path) in files {
    let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let minimal: MemoryFileMinimal =
      serde_json::from_str(&text).map_err(|e| format!("Invalid memory JSON: {e}"))?;
    let meta = fs::metadata(&path).map_err(|e| e.to_string())?;
    let updated_ms = meta
      .modified()
      .ok()
      .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
      .map(|d| d.as_millis() as i64)
      .unwrap_or(0);
    tx.execute(
      "INSERT INTO memory_entries (workspace_id, entry_id, kind, summary, status, relative_path, updated_at_ms)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
      params![
        workspace_id,
        minimal.id,
        minimal.kind,
        minimal.summary,
        minimal.status,
        rel_path,
        updated_ms
      ],
    )
    .map_err(|e| e.to_string())?;
  }
  tx.commit().map_err(|e| e.to_string())?;
  Ok(())
}
