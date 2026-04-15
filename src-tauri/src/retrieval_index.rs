//! Workspace semantic retrieval: chunk storage and cosine similarity search.

use std::cmp::Ordering;

use rusqlite::params;
use serde::Deserialize;
use serde::Serialize;
use tauri::AppHandle;

use crate::db;

fn l2_norm(mut v: Vec<f32>) -> Option<Vec<f32>> {
  let s: f32 = v.iter().map(|x| x * x).sum();
  if s <= 0.0 || !s.is_finite() {
    return None;
  }
  let inv = s.sqrt().recip();
  for x in &mut v {
    *x *= inv;
  }
  Some(v)
}

fn cosine_similarity(a: &[f32], b: &[f32]) -> Option<f32> {
  if a.len() != b.len() || a.is_empty() {
    return None;
  }
  let mut dot = 0.0_f32;
  for i in 0..a.len() {
    dot += a[i] * b[i];
  }
  if dot.is_finite() { Some(dot) } else { None }
}

fn blob_to_f32_vec(blob: &[u8]) -> Option<Vec<f32>> {
  if blob.len() % 4 != 0 {
    return None;
  }
  let n = blob.len() / 4;
  let mut out = Vec::with_capacity(n);
  for i in 0..n {
    let chunk = blob[i * 4..(i + 1) * 4].try_into().ok()?;
    out.push(f32::from_le_bytes(chunk));
  }
  Some(out)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetrievalChunkInput {
  pub chunk_ordinal: i32,
  pub source_kind: String,
  /// JSON string (path, line range, conversation ids, etc.)
  pub source_ref: String,
  pub body_text: String,
  pub content_hash: String,
  pub embedding_model_id: String,
  pub embedding_dim: i32,
  /// L2-normalized or raw — search normalizes query; stored vectors normalized on insert.
  pub embedding: Vec<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetrievalSearchHit {
  pub score: f32,
  pub source_id: String,
  pub chunk_ordinal: i32,
  pub source_kind: String,
  pub source_ref: String,
  pub body_text: String,
  pub embedding_model_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetrievalIndexStatus {
  pub chunk_count: i64,
  pub source_count: i64,
}

/// Replace all chunks for a logical source (e.g. one file or one conversation).
#[tauri::command]
pub fn retrieval_replace_source_chunks(
  app: AppHandle,
  workspace_id: String,
  source_id: String,
  chunks: Vec<RetrievalChunkInput>,
) -> Result<(), String> {
  let conn = db::open_connection(&app).map_err(|e| e.to_string())?;
  let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
  tx.execute(
    "DELETE FROM retrieval_chunks WHERE workspace_id = ?1 AND source_id = ?2",
    params![workspace_id, source_id],
  )
  .map_err(|e| e.to_string())?;

  let indexed_at_ms = chrono_now_ms();
  for ch in chunks {
    let emb = l2_norm(ch.embedding).ok_or_else(|| {
      "Invalid embedding: could not normalize (zero or non-finite).".to_string()
    })?;
    let dim = emb.len();
    if dim != ch.embedding_dim as usize {
      return Err(format!(
        "embedding_dim {} does not match vector length {}",
        ch.embedding_dim, dim
      ));
    }
    let mut blob = Vec::with_capacity(dim * 4);
    for f in emb {
      blob.extend_from_slice(&f.to_le_bytes());
    }
    tx.execute(
      "INSERT INTO retrieval_chunks (
        workspace_id, source_id, chunk_ordinal, source_kind, source_ref, body_text, content_hash,
        indexed_at_ms, embedding_model_id, embedding_dim, embedding
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
      params![
        workspace_id,
        source_id,
        ch.chunk_ordinal,
        ch.source_kind,
        ch.source_ref,
        ch.body_text,
        ch.content_hash,
        indexed_at_ms,
        ch.embedding_model_id,
        ch.embedding_dim,
        blob,
      ],
    )
    .map_err(|e| e.to_string())?;
  }
  tx.commit().map_err(|e| e.to_string())?;
  Ok(())
}

fn chrono_now_ms() -> i64 {
  std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map(|d| d.as_millis() as i64)
    .unwrap_or(0)
}

#[tauri::command]
pub fn retrieval_delete_source(app: AppHandle, workspace_id: String, source_id: String) -> Result<(), String> {
  let conn = db::open_connection(&app).map_err(|e| e.to_string())?;
  conn
    .execute(
      "DELETE FROM retrieval_chunks WHERE workspace_id = ?1 AND source_id = ?2",
      params![workspace_id, source_id],
    )
    .map_err(|e| e.to_string())?;
  Ok(())
}

#[tauri::command]
pub fn retrieval_clear_workspace(app: AppHandle, workspace_id: String) -> Result<(), String> {
  let conn = db::open_connection(&app).map_err(|e| e.to_string())?;
  conn
    .execute(
      "DELETE FROM retrieval_chunks WHERE workspace_id = ?1",
      params![workspace_id],
    )
    .map_err(|e| e.to_string())?;
  conn
    .execute(
      "DELETE FROM retrieval_source_state WHERE workspace_id = ?1",
      params![workspace_id],
    )
    .map_err(|e| e.to_string())?;
  Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetrievalSearchParams {
  pub workspace_id: String,
  pub query_embedding: Vec<f32>,
  pub embedding_model_id: String,
  pub top_k: usize,
  /// When non-empty, only include these source_kind values (e.g. ["file"]).
  pub source_kinds: Option<Vec<String>>,
}

#[tauri::command]
pub fn retrieval_search(app: AppHandle, input: RetrievalSearchParams) -> Result<Vec<RetrievalSearchHit>, String> {
  let top_k = input.top_k.max(1).min(500);
  let q = l2_norm(input.query_embedding).ok_or_else(|| {
    "Invalid query embedding: could not normalize.".to_string()
  })?;
  let qdim = q.len();
  let model = input.embedding_model_id.trim();
  if model.is_empty() {
    return Err("embedding_model_id is required.".to_string());
  }

  let conn = db::open_connection(&app).map_err(|e| e.to_string())?;
  let mut stmt = conn
    .prepare(
      "SELECT source_id, chunk_ordinal, source_kind, source_ref, body_text, embedding_dim, embedding, embedding_model_id
       FROM retrieval_chunks
       WHERE workspace_id = ?1 AND embedding_model_id = ?2 AND embedding_dim = ?3",
    )
    .map_err(|e| e.to_string())?;

  let kind_filter: Option<Vec<String>> = input
    .source_kinds
    .filter(|v| !v.is_empty());

  let rows = stmt
    .query_map(
      params![input.workspace_id, model, qdim as i32],
      |row| {
        Ok((
          row.get::<_, String>(0)?,
          row.get::<_, i32>(1)?,
          row.get::<_, String>(2)?,
          row.get::<_, String>(3)?,
          row.get::<_, String>(4)?,
          row.get::<_, i32>(5)?,
          row.get::<_, Vec<u8>>(6)?,
          row.get::<_, String>(7)?,
        ))
      },
    )
    .map_err(|e| e.to_string())?;

  let mut scored: Vec<(f32, RetrievalSearchHit)> = Vec::new();
  for row in rows {
    let (source_id, chunk_ordinal, source_kind, source_ref, body_text, dim, blob, emb_model) =
      row.map_err(|e| e.to_string())?;
    if let Some(ref kinds) = kind_filter {
      if !kinds.iter().any(|k| k == &source_kind) {
        continue;
      }
    }
    if dim as usize != qdim {
      continue;
    }
    let vec = match blob_to_f32_vec(&blob) {
      Some(v) if v.len() == qdim => v,
      _ => continue,
    };
    let score = match cosine_similarity(&q, &vec) {
      Some(s) => s,
      None => continue,
    };
    scored.push((
      score,
      RetrievalSearchHit {
        score,
        source_id,
        chunk_ordinal,
        source_kind,
        source_ref,
        body_text,
        embedding_model_id: emb_model,
      },
    ));
  }

  scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(Ordering::Equal));
  scored.truncate(top_k);
  Ok(scored.into_iter().map(|(_, h)| h).collect())
}

#[tauri::command]
pub fn retrieval_index_status(app: AppHandle, workspace_id: String) -> Result<RetrievalIndexStatus, String> {
  let conn = db::open_connection(&app).map_err(|e| e.to_string())?;
  let chunk_count: i64 = conn
    .query_row(
      "SELECT COUNT(*) FROM retrieval_chunks WHERE workspace_id = ?1",
      params![workspace_id],
      |row| row.get(0),
    )
    .map_err(|e| e.to_string())?;
  let source_count: i64 = conn
    .query_row(
      "SELECT COUNT(DISTINCT source_id) FROM retrieval_chunks WHERE workspace_id = ?1",
      params![workspace_id],
      |row| row.get(0),
    )
    .map_err(|e| e.to_string())?;
  Ok(RetrievalIndexStatus {
    chunk_count,
    source_count,
  })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetrievalSourceStateInput {
  pub source_id: String,
  pub mtime_ms: Option<i64>,
  pub content_hash: String,
}

/// Upsert incremental index state for a source (file fingerprint).
#[tauri::command]
pub fn retrieval_put_source_state(
  app: AppHandle,
  workspace_id: String,
  entries: Vec<RetrievalSourceStateInput>,
) -> Result<(), String> {
  let conn = db::open_connection(&app).map_err(|e| e.to_string())?;
  let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
  for e in entries {
    tx.execute(
      "INSERT INTO retrieval_source_state (workspace_id, source_id, mtime_ms, content_hash)
       VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(workspace_id, source_id) DO UPDATE SET
         mtime_ms = excluded.mtime_ms,
         content_hash = excluded.content_hash",
      params![workspace_id, e.source_id, e.mtime_ms, e.content_hash],
    )
    .map_err(|e| e.to_string())?;
  }
  tx.commit().map_err(|e| e.to_string())?;
  Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetrievalSourceStateDto {
  pub mtime_ms: Option<i64>,
  pub content_hash: String,
}

#[tauri::command]
pub fn retrieval_get_source_state(
  app: AppHandle,
  workspace_id: String,
  source_id: String,
) -> Result<Option<RetrievalSourceStateDto>, String> {
  let conn = db::open_connection(&app).map_err(|e| e.to_string())?;
  let row: Result<(Option<i64>, String), rusqlite::Error> = conn.query_row(
    "SELECT mtime_ms, content_hash FROM retrieval_source_state WHERE workspace_id = ?1 AND source_id = ?2",
    params![workspace_id, source_id],
    |r| Ok((r.get(0)?, r.get(1)?)),
  );
  match row {
    Ok((mtime_ms, content_hash)) => Ok(Some(RetrievalSourceStateDto {
      mtime_ms,
      content_hash,
    })),
    Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
    Err(e) => Err(e.to_string()),
  }
}
