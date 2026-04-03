use std::path::{Path, PathBuf};

use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

use crate::db;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRecord {
  pub id: String,
  pub name: String,
  pub root_path: String,
  pub created_at_ms: i64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ConversationRecord {
  pub id: String,
  pub workspace_id: String,
  pub title: String,
  pub updated_at_ms: i64,
  pub canvas_kind: String,
}

fn now_ms() -> i64 {
  std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map(|d| d.as_millis() as i64)
    .unwrap_or(0)
}

fn workspaces_root(app: &AppHandle) -> Result<PathBuf, String> {
  let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
  Ok(dir.join("workspaces"))
}

pub fn ensure_workspaces_dir(app: &AppHandle) -> Result<PathBuf, String> {
  let root = workspaces_root(app)?;
  std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
  Ok(root)
}

/// If there are no workspaces, create `workspaces/Default` under app data and register it.
pub fn ensure_default_workspace(app: &AppHandle) -> Result<(), String> {
  let conn = db::open_connection(app).map_err(|e| e.to_string())?;
  let count: i64 = conn
    .query_row("SELECT COUNT(*) FROM workspaces", [], |r| r.get(0))
    .map_err(|e| e.to_string())?;
  if count > 0 {
    return Ok(());
  }
  let root = ensure_workspaces_dir(app)?;
  let default_path = root.join("Default");
  std::fs::create_dir_all(&default_path).map_err(|e| e.to_string())?;
  let path_str = resolve_workspace_dir(&default_path)?;
  let id = Uuid::new_v4().to_string();
  let now = now_ms();
  conn
    .execute(
      "INSERT INTO workspaces (id, name, root_path, created_at_ms) VALUES (?1, ?2, ?3, ?4)",
      params![id, "Default", path_str, now],
    )
    .map_err(|e| e.to_string())?;
  Ok(())
}

fn sanitize_folder_name(name: &str) -> String {
  let s: String = name
    .chars()
    .map(|c| match c {
      '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '-',
      c if c.is_control() => '-',
      c => c,
    })
    .collect();
  let trimmed = s.trim().trim_matches('.').trim_matches('-');
  if trimmed.is_empty() {
    "workspace".to_string()
  } else {
    trimmed.to_string()
  }
}

fn unique_dir_under(base: &Path, base_name: &str) -> Result<PathBuf, String> {
  let mut candidate = base.join(base_name);
  if !candidate.exists() {
    return Ok(candidate);
  }
  for n in 2_i32..10_000 {
    candidate = base.join(format!("{base_name}-{n}"));
    if !candidate.exists() {
      return Ok(candidate);
    }
  }
  Err("Could not find a free folder name.".to_string())
}

fn resolve_workspace_dir(path: &Path) -> Result<String, String> {
  let meta = std::fs::metadata(path).map_err(|e| e.to_string())?;
  if !meta.is_dir() {
    return Err("Path is not a folder.".to_string());
  }
  path
    .canonicalize()
    .map(|p| p.to_string_lossy().to_string())
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn workspace_list(app: AppHandle) -> Result<Vec<WorkspaceRecord>, String> {
  let conn = db::open_connection(&app).map_err(|e| e.to_string())?;
  let mut stmt = conn
    .prepare(
      "SELECT id, name, root_path, created_at_ms FROM workspaces ORDER BY name COLLATE NOCASE",
    )
    .map_err(|e| e.to_string())?;
  let rows = stmt
    .query_map([], |row| {
      Ok(WorkspaceRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        root_path: row.get(2)?,
        created_at_ms: row.get(3)?,
      })
    })
    .map_err(|e| e.to_string())?;
  let mut out = Vec::new();
  for r in rows {
    out.push(r.map_err(|e| e.to_string())?);
  }
  Ok(out)
}

#[tauri::command]
pub fn workspace_get_default_root(app: AppHandle) -> Result<String, String> {
  let root = ensure_workspaces_dir(&app)?;
  root
    .canonicalize()
    .map(|p| p.to_string_lossy().to_string())
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn workspace_create(
  app: AppHandle,
  parent_path: String,
  name: String,
) -> Result<WorkspaceRecord, String> {
  let trimmed = name.trim();
  if trimmed.is_empty() {
    return Err("Workspace name is required.".to_string());
  }
  let parent_trim = parent_path.trim();
  if parent_trim.is_empty() {
    return Err("Choose a parent folder where the workspace folder will be created.".to_string());
  }
  let parent = PathBuf::from(parent_trim);
  let parent_meta = std::fs::metadata(&parent).map_err(|e| e.to_string())?;
  if !parent_meta.is_dir() {
    return Err("Parent path is not a folder.".to_string());
  }
  let parent_canon = parent.canonicalize().map_err(|e| e.to_string())?;
  let slug = sanitize_folder_name(trimmed);
  let dir = unique_dir_under(&parent_canon, &slug)?;
  std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  let path_str = resolve_workspace_dir(&dir)?;
  let id = Uuid::new_v4().to_string();
  let now = now_ms();
  let conn = db::open_connection(&app).map_err(|e| e.to_string())?;
  if let Err(e) = conn.execute(
    "INSERT INTO workspaces (id, name, root_path, created_at_ms) VALUES (?1, ?2, ?3, ?4)",
    params![id, trimmed, path_str.clone(), now],
  ) {
    let _ = std::fs::remove_dir(&dir);
    return Err(if e.to_string().contains("UNIQUE") {
      "That folder is already registered as a workspace.".to_string()
    } else {
      e.to_string()
    });
  }
  Ok(WorkspaceRecord {
    id,
    name: trimmed.to_string(),
    root_path: path_str,
    created_at_ms: now,
  })
}

#[tauri::command]
pub fn workspace_add_from_path(
  app: AppHandle,
  path: String,
  display_name: Option<String>,
) -> Result<WorkspaceRecord, String> {
  let p = PathBuf::from(path.trim());
  let path_str = resolve_workspace_dir(&p)?;
  let name = match display_name {
    Some(n) if !n.trim().is_empty() => n.trim().to_string(),
    _ => p
      .file_name()
      .and_then(|s| s.to_str())
      .unwrap_or("Workspace")
      .to_string(),
  };
  let id = Uuid::new_v4().to_string();
  let now = now_ms();
  let conn = db::open_connection(&app).map_err(|e| e.to_string())?;
  conn
    .execute(
      "INSERT INTO workspaces (id, name, root_path, created_at_ms) VALUES (?1, ?2, ?3, ?4)",
      params![id, name, path_str.clone(), now],
    )
    .map_err(|e| {
      if e.to_string().contains("UNIQUE") {
        "That folder is already a workspace.".to_string()
      } else {
        e.to_string()
      }
    })?;
  Ok(WorkspaceRecord {
    id,
    name,
    root_path: path_str,
    created_at_ms: now,
  })
}

#[tauri::command]
pub fn workspace_remove(app: AppHandle, id: String) -> Result<(), String> {
  let conn = db::open_connection(&app).map_err(|e| e.to_string())?;
  let n = conn
    .execute("DELETE FROM workspaces WHERE id = ?1", params![id])
    .map_err(|e| e.to_string())?;
  if n == 0 {
    return Err("Workspace not found.".to_string());
  }
  Ok(())
}

#[tauri::command]
pub fn workspace_rename(app: AppHandle, id: String, name: String) -> Result<(), String> {
  let trimmed = name.trim();
  if trimmed.is_empty() {
    return Err("Name is required.".to_string());
  }
  let conn = db::open_connection(&app).map_err(|e| e.to_string())?;
  let n = conn
    .execute(
      "UPDATE workspaces SET name = ?1 WHERE id = ?2",
      params![trimmed, id],
    )
    .map_err(|e| e.to_string())?;
  if n == 0 {
    return Err("Workspace not found.".to_string());
  }
  Ok(())
}

#[tauri::command]
pub fn conversation_list(
  app: AppHandle,
  workspace_id: String,
) -> Result<Vec<ConversationRecord>, String> {
  let conn = db::open_connection(&app).map_err(|e| e.to_string())?;
  let mut stmt = conn
    .prepare(
      "SELECT id, workspace_id, title, updated_at_ms, canvas_kind FROM conversations
       WHERE workspace_id = ?1 ORDER BY updated_at_ms DESC",
    )
    .map_err(|e| e.to_string())?;
  let rows = stmt
    .query_map(params![workspace_id], |row| {
      Ok(ConversationRecord {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        title: row.get(2)?,
        updated_at_ms: row.get(3)?,
        canvas_kind: row.get(4)?,
      })
    })
    .map_err(|e| e.to_string())?;
  let mut out = Vec::new();
  for r in rows {
    out.push(r.map_err(|e| e.to_string())?);
  }
  Ok(out)
}

#[tauri::command]
pub fn conversation_create(
  app: AppHandle,
  workspace_id: String,
) -> Result<ConversationRecord, String> {
  let conn = db::open_connection(&app).map_err(|e| e.to_string())?;
  let exists: i64 = conn
    .query_row(
      "SELECT COUNT(*) FROM workspaces WHERE id = ?1",
      params![&workspace_id],
      |r| r.get(0),
    )
    .map_err(|e| e.to_string())?;
  if exists == 0 {
    return Err("Workspace not found.".to_string());
  }
  let id = Uuid::new_v4().to_string();
  let now = now_ms();
  let ws = workspace_id.clone();
  conn
    .execute(
      "INSERT INTO conversations (id, workspace_id, title, updated_at_ms, canvas_kind)
       VALUES (?1, ?2, ?3, ?4, 'document')",
      params![&id, &ws, "New chat", now],
    )
    .map_err(|e| e.to_string())?;
  Ok(ConversationRecord {
    id,
    workspace_id: ws,
    title: "New chat".to_string(),
    updated_at_ms: now,
    canvas_kind: "document".to_string(),
  })
}

#[tauri::command]
pub fn conversation_get(app: AppHandle, id: String) -> Result<Option<ConversationRecord>, String> {
  let conn = db::open_connection(&app).map_err(|e| e.to_string())?;
  let row = conn
    .query_row(
      "SELECT id, workspace_id, title, updated_at_ms, canvas_kind FROM conversations WHERE id = ?1",
      params![id],
      |row| {
        Ok(ConversationRecord {
          id: row.get(0)?,
          workspace_id: row.get(1)?,
          title: row.get(2)?,
          updated_at_ms: row.get(3)?,
          canvas_kind: row.get(4)?,
        })
      },
    )
    .optional()
    .map_err(|e| e.to_string())?;
  Ok(row)
}
