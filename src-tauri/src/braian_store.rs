use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;
use uuid::Uuid;

use crate::db;

const CONVERSATION_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationRecord {
  pub id: String,
  pub workspace_id: String,
  pub title: String,
  pub updated_at_ms: i64,
  pub canvas_kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConversationFileV1 {
  schema_version: u32,
  id: String,
  workspace_id: String,
  title: String,
  updated_at_ms: i64,
  canvas_kind: String,
  artifact_open: bool,
  draft: String,
  messages: Vec<ChatMessageFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatMessageFile {
  id: String,
  role: String,
  content: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessageDto {
  pub id: String,
  pub role: String,
  pub content: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatThreadDto {
  pub messages: Vec<ChatMessageDto>,
  pub artifact_open: bool,
  pub artifact_payload: Option<Value>,
  pub draft: String,
  pub generating: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationOpenDto {
  pub conversation: ConversationRecord,
  pub thread: ChatThreadDto,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationSaveInput {
  pub id: String,
  pub workspace_id: String,
  pub title: String,
  pub canvas_kind: String,
  pub artifact_open: bool,
  pub draft: String,
  pub messages: Vec<ChatMessageDto>,
  pub artifact_payload: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasDocumentWriteInput {
  pub workspace_id: String,
  pub conversation_id: String,
  pub markdown: String,
  pub title: Option<String>,
}

fn now_ms() -> i64 {
  std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map(|d| d.as_millis() as i64)
    .unwrap_or(0)
}

fn braian_dir(workspace_root: &Path) -> PathBuf {
  workspace_root.join(".braian")
}

fn conversations_dir(workspace_root: &Path) -> PathBuf {
  braian_dir(workspace_root).join("conversations")
}

fn artifacts_dir(workspace_root: &Path) -> PathBuf {
  braian_dir(workspace_root).join("artifacts")
}

fn canvas_dir(workspace_root: &Path) -> PathBuf {
  braian_dir(workspace_root).join("canvas")
}

fn conversation_path(workspace_root: &Path, id: &str) -> PathBuf {
  conversations_dir(workspace_root).join(format!("{id}.json"))
}

fn artifact_path(workspace_root: &Path, id: &str) -> PathBuf {
  artifacts_dir(workspace_root).join(format!("{id}.json"))
}

fn canvas_md_path(workspace_root: &Path, conversation_id: &str) -> PathBuf {
  canvas_dir(workspace_root).join(format!("{conversation_id}.md"))
}

fn ensure_braian_layout(workspace_root: &Path) -> Result<(), String> {
  let b = braian_dir(workspace_root);
  fs::create_dir_all(conversations_dir(workspace_root)).map_err(|e| e.to_string())?;
  fs::create_dir_all(artifacts_dir(workspace_root)).map_err(|e| e.to_string())?;
  fs::create_dir_all(canvas_dir(workspace_root)).map_err(|e| e.to_string())?;
  let schema_path = b.join("schema.json");
  if !schema_path.exists() {
    fs::create_dir_all(&b).map_err(|e| e.to_string())?;
    fs::write(&schema_path, "{\"version\":1}\n").map_err(|e| e.to_string())?;
  }
  Ok(())
}

fn workspace_root_path(conn: &Connection, workspace_id: &str) -> Result<PathBuf, String> {
  let path: String = conn
    .query_row(
      "SELECT root_path FROM workspaces WHERE id = ?1",
      params![workspace_id],
      |row| row.get(0),
    )
    .map_err(|_| "Workspace not found.".to_string())?;
  Ok(PathBuf::from(path))
}

fn list_workspace_roots(conn: &Connection) -> Result<Vec<PathBuf>, String> {
  let mut stmt = conn
    .prepare("SELECT root_path FROM workspaces")
    .map_err(|e| e.to_string())?;
  let rows = stmt
    .query_map([], |row| {
      let p: String = row.get(0)?;
      Ok(PathBuf::from(p))
    })
    .map_err(|e| e.to_string())?;
  let mut out = Vec::new();
  for r in rows {
    out.push(r.map_err(|e| e.to_string())?);
  }
  Ok(out)
}

fn kind_from_value(v: &Value) -> Option<String> {
  v.get("kind").and_then(|k| k.as_str()).map(str::to_string)
}

fn file_to_record(f: &ConversationFileV1, canvas_kind_override: Option<String>) -> ConversationRecord {
  let canvas_kind = canvas_kind_override.unwrap_or_else(|| f.canvas_kind.clone());
  ConversationRecord {
    id: f.id.clone(),
    workspace_id: f.workspace_id.clone(),
    title: f.title.clone(),
    updated_at_ms: f.updated_at_ms,
    canvas_kind,
  }
}

fn load_conversation_file(path: &Path) -> Result<ConversationFileV1, String> {
  let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
  serde_json::from_str(&raw).map_err(|e| format!("Invalid conversation file {}: {e}", path.display()))
}

fn load_artifact(workspace_root: &Path, id: &str) -> Option<Value> {
  let p = artifact_path(workspace_root, id);
  if !p.is_file() {
    return None;
  }
  fs::read_to_string(&p).ok().and_then(|s| serde_json::from_str(&s).ok())
}

/// Canonical body: `.braian/canvas/<id>.md` if present; else legacy `body` inside document artifact JSON.
fn load_document_body(
  workspace_root: &Path,
  conversation_id: &str,
  artifact_json: Option<&Value>,
) -> String {
  let md_path = canvas_md_path(workspace_root, conversation_id);
  if md_path.is_file() {
    return fs::read_to_string(&md_path).unwrap_or_default();
  }
  if let Some(v) = artifact_json {
    if kind_from_value(v).as_deref() == Some("document") {
      return v
        .get("body")
        .and_then(|b| b.as_str())
        .unwrap_or("")
        .to_string();
    }
  }
  String::new()
}

fn document_payload_value(title: Option<Value>, body: String) -> Value {
  let mut m = serde_json::Map::new();
  m.insert(
    "kind".to_string(),
    Value::String("document".to_string()),
  );
  if let Some(t) = title {
    if !t.is_null() {
      m.insert("title".to_string(), t);
    }
  }
  m.insert("body".to_string(), Value::String(body));
  Value::Object(m)
}

/// Merge markdown-on-disk + slim or legacy JSON into the thread payload the UI expects.
fn resolve_artifact_for_open(
  root: &Path,
  conversation_id: &str,
  artifact: Option<Value>,
) -> Option<Value> {
  let kind = artifact.as_ref().and_then(kind_from_value);
  if kind.as_deref() == Some("document") {
    let body = load_document_body(root, conversation_id, artifact.as_ref());
    let title = artifact
      .as_ref()
      .and_then(|v| v.get("title"))
      .cloned();
    return Some(document_payload_value(title, body));
  }
  if canvas_md_path(root, conversation_id).is_file() && kind.is_none() {
    let body = fs::read_to_string(canvas_md_path(root, conversation_id)).unwrap_or_default();
    let title = artifact
      .as_ref()
      .and_then(|v| v.get("title"))
      .cloned();
    return Some(document_payload_value(title, body));
  }
  artifact
}

fn save_document_canvas(
  root: &Path,
  conversation_id: &str,
  title: Option<&Value>,
  body: &str,
) -> Result<(), String> {
  fs::create_dir_all(canvas_dir(root)).map_err(|e| e.to_string())?;
  let md_path = canvas_md_path(root, conversation_id);
  fs::write(&md_path, body).map_err(|e| e.to_string())?;
  let mut m = serde_json::Map::new();
  m.insert(
    "kind".to_string(),
    Value::String("document".to_string()),
  );
  if let Some(t) = title {
    if !t.is_null() {
      m.insert("title".to_string(), t.clone());
    }
  }
  let slim = Value::Object(m);
  let art_path = artifact_path(root, conversation_id);
  let aj = serde_json::to_string_pretty(&slim).map_err(|e| e.to_string())?;
  fs::write(&art_path, aj).map_err(|e| e.to_string())?;
  Ok(())
}

fn thread_from_files(f: ConversationFileV1, artifact: Option<Value>) -> ChatThreadDto {
  let messages = f
    .messages
    .into_iter()
    .map(|m| ChatMessageDto {
      id: m.id,
      role: m.role,
      content: m.content,
      status: m.status,
    })
    .collect();
  ChatThreadDto {
    messages,
    artifact_open: f.artifact_open,
    artifact_payload: artifact,
    draft: f.draft,
    generating: false,
  }
}

#[tauri::command]
pub fn conversation_list(
  app: AppHandle,
  workspace_id: String,
) -> Result<Vec<ConversationRecord>, String> {
  let conn = db::open_connection(&app).map_err(|e| e.to_string())?;
  let root = workspace_root_path(&conn, &workspace_id)?;
  let dir = conversations_dir(&root);
  if !dir.is_dir() {
    return Ok(vec![]);
  }
  let mut records: Vec<ConversationRecord> = Vec::new();
  for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
    let entry = entry.map_err(|e| e.to_string())?;
    let path = entry.path();
    if path.extension().map_or(true, |e| e != "json") {
      continue;
    }
    let f = match load_conversation_file(&path) {
      Ok(v) => v,
      Err(e) => {
        log::warn!("{e}");
        continue;
      }
    };
    if f.workspace_id != workspace_id {
      continue;
    }
    if f.schema_version != CONVERSATION_SCHEMA_VERSION {
      log::warn!(
        "Skipping conversation {} unsupported schema {}",
        f.id,
        f.schema_version
      );
      continue;
    }
    let artifact = load_artifact(&root, &f.id);
    let ck = kind_from_value(artifact.as_ref().unwrap_or(&Value::Null))
      .unwrap_or(f.canvas_kind.clone());
    records.push(file_to_record(&f, Some(ck)));
  }
  records.sort_by(|a, b| b.updated_at_ms.cmp(&a.updated_at_ms));
  Ok(records)
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
  let root = workspace_root_path(&conn, &workspace_id)?;
  ensure_braian_layout(&root)?;
  let id = Uuid::new_v4().to_string();
  let now = now_ms();
  let file = ConversationFileV1 {
    schema_version: CONVERSATION_SCHEMA_VERSION,
    id: id.clone(),
    workspace_id: workspace_id.clone(),
    title: "New chat".to_string(),
    updated_at_ms: now,
    canvas_kind: "document".to_string(),
    artifact_open: false,
    draft: String::new(),
    messages: vec![],
  };
  let path = conversation_path(&root, &id);
  let json = serde_json::to_string_pretty(&file).map_err(|e| e.to_string())?;
  fs::write(&path, json).map_err(|e| e.to_string())?;
  Ok(ConversationRecord {
    id,
    workspace_id,
    title: "New chat".to_string(),
    updated_at_ms: now,
    canvas_kind: "document".to_string(),
  })
}

fn find_conversation_root(
  conn: &Connection,
  conversation_id: &str,
) -> Result<(PathBuf, ConversationFileV1), String> {
  for root in list_workspace_roots(conn)? {
    let path = conversation_path(&root, conversation_id);
    if path.is_file() {
      let f = load_conversation_file(&path)?;
      if f.id != conversation_id {
        return Err("Conversation file id mismatch.".to_string());
      }
      return Ok((root, f));
    }
  }
  Err("Conversation not found.".to_string())
}

#[tauri::command]
pub fn conversation_open(app: AppHandle, id: String) -> Result<Option<ConversationOpenDto>, String> {
  let conn = db::open_connection(&app).map_err(|e| e.to_string())?;
  let (root, f) = match find_conversation_root(&conn, &id) {
    Ok(x) => x,
    Err(e) if e == "Conversation not found." => return Ok(None),
    Err(e) => return Err(e),
  };
  if f.schema_version != CONVERSATION_SCHEMA_VERSION {
    return Err(format!(
      "Unsupported conversation schema version {}",
      f.schema_version
    ));
  }
  let artifact = load_artifact(&root, &f.id);
  let artifact = resolve_artifact_for_open(&root, &f.id, artifact);
  let ck = kind_from_value(artifact.as_ref().unwrap_or(&Value::Null))
    .unwrap_or_else(|| f.canvas_kind.clone());
  let conversation = file_to_record(&f, Some(ck));
  let thread = thread_from_files(f, artifact);
  Ok(Some(ConversationOpenDto { conversation, thread }))
}

#[tauri::command]
pub fn conversation_save(app: AppHandle, input: ConversationSaveInput) -> Result<(), String> {
  let conn = db::open_connection(&app).map_err(|e| e.to_string())?;
  let root = workspace_root_path(&conn, &input.workspace_id)?;
  let path = conversation_path(&root, &input.id);
  if !path.is_file() {
    return Err("Conversation not found.".to_string());
  }
  let existing = load_conversation_file(&path)?;
  if existing.workspace_id != input.workspace_id || existing.id != input.id {
    return Err("Conversation workspace mismatch.".to_string());
  }
  ensure_braian_layout(&root)?;
  let now = now_ms();
  let file = ConversationFileV1 {
    schema_version: CONVERSATION_SCHEMA_VERSION,
    id: input.id.clone(),
    workspace_id: input.workspace_id.clone(),
    title: input.title.clone(),
    updated_at_ms: now,
    canvas_kind: input.canvas_kind.clone(),
    artifact_open: input.artifact_open,
    draft: input.draft.clone(),
    messages: input
      .messages
      .iter()
      .map(|m| ChatMessageFile {
        id: m.id.clone(),
        role: m.role.clone(),
        content: m.content.clone(),
        status: m.status.clone(),
      })
      .collect(),
  };
  let json = serde_json::to_string_pretty(&file).map_err(|e| e.to_string())?;
  fs::write(&path, json).map_err(|e| e.to_string())?;
  let art_path = artifact_path(&root, &input.id);
  let canvas_md = canvas_md_path(&root, &input.id);
  match &input.artifact_payload {
    Some(v) if !v.is_null() => {
      let kind = kind_from_value(v).unwrap_or_default();
      if kind == "document" {
        let body = v
          .get("body")
          .and_then(|b| b.as_str())
          .unwrap_or("");
        let title = v.get("title");
        save_document_canvas(&root, &input.id, title, body)?;
      } else {
        if canvas_md.is_file() {
          let _ = fs::remove_file(&canvas_md);
        }
        let aj = serde_json::to_string_pretty(v).map_err(|e| e.to_string())?;
        fs::write(&art_path, aj).map_err(|e| e.to_string())?;
      }
    }
    _ => {
      if art_path.is_file() {
        let _ = fs::remove_file(&art_path);
      }
      if canvas_md.is_file() {
        let _ = fs::remove_file(&canvas_md);
      }
    }
  }
  Ok(())
}

/// Write document canvas markdown + slim artifact JSON (for AI tools without a full conversation save).
#[tauri::command]
pub fn canvas_document_write(
  app: AppHandle,
  input: CanvasDocumentWriteInput,
) -> Result<(), String> {
  let conn = db::open_connection(&app).map_err(|e| e.to_string())?;
  let root = workspace_root_path(&conn, &input.workspace_id)?;
  let path = conversation_path(&root, &input.conversation_id);
  if !path.is_file() {
    return Err("Conversation not found.".to_string());
  }
  let f = load_conversation_file(&path)?;
  if f.workspace_id != input.workspace_id || f.id != input.conversation_id {
    return Err("Conversation workspace mismatch.".to_string());
  }
  ensure_braian_layout(&root)?;
  let title_json = input
    .title
    .as_ref()
    .filter(|t| !t.is_empty())
    .map(|t| Value::String(t.clone()));
  save_document_canvas(
    &root,
    &input.conversation_id,
    title_json.as_ref(),
    &input.markdown,
  )
}
