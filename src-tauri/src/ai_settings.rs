use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::db;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSettingsRecord {
  pub provider: String,
  pub api_key: String,
  pub model_id: String,
  pub base_url: Option<String>,
  /// Max tokens for prior chat messages sent to the model (short-term memory budget).
  pub context_max_history_tokens: i64,
  #[serde(default)]
  pub embedding_model_id: String,
  /// When 1, inject retrieved RAG context into the system prompt each turn.
  #[serde(default = "default_retrieval_auto_inject")]
  pub retrieval_auto_inject: i64,
  /// Approximate max tokens for the retrieved-context system section.
  #[serde(default = "default_retrieval_max_tokens")]
  pub retrieval_max_tokens: i64,
  #[serde(default)]
  pub embedding_fallback_base_url: Option<String>,
  #[serde(default)]
  pub embedding_fallback_api_key: Option<String>,
  #[serde(default)]
  pub embedding_fallback_model: Option<String>,
}

fn default_retrieval_auto_inject() -> i64 {
  1
}

fn default_retrieval_max_tokens() -> i64 {
  4096
}

fn default_settings() -> AiSettingsRecord {
  AiSettingsRecord {
    provider: "openai".to_string(),
    api_key: String::new(),
    model_id: "gpt-5.4".to_string(),
    base_url: None,
    context_max_history_tokens: 65_536,
    embedding_model_id: String::new(),
    retrieval_auto_inject: 1,
    retrieval_max_tokens: 4096,
    embedding_fallback_base_url: None,
    embedding_fallback_api_key: None,
    embedding_fallback_model: None,
  }
}

#[tauri::command]
pub fn ai_settings_get(app: AppHandle) -> Result<AiSettingsRecord, String> {
  let conn = db::open_connection(&app).map_err(|e| e.to_string())?;
  let row: Result<
    (
      String,
      String,
      String,
      Option<String>,
      i64,
      String,
      i64,
      i64,
      Option<String>,
      Option<String>,
      Option<String>,
    ),
    rusqlite::Error,
  > = conn.query_row(
    "SELECT provider, api_key, model_id, base_url, context_max_history_tokens,
            embedding_model_id, retrieval_auto_inject, retrieval_max_tokens,
            embedding_fallback_base_url, embedding_fallback_api_key, embedding_fallback_model
     FROM ai_settings WHERE id = 1",
    [],
    |r| {
      Ok((
        r.get(0)?,
        r.get(1)?,
        r.get(2)?,
        r.get(3)?,
        r.get(4)?,
        r.get(5)?,
        r.get(6)?,
        r.get(7)?,
        r.get(8)?,
        r.get(9)?,
        r.get(10)?,
      ))
    },
  );
  match row {
    Ok((
      provider,
      api_key,
      model_id,
      base_url,
      context_max_history_tokens,
      embedding_model_id,
      retrieval_auto_inject,
      retrieval_max_tokens,
      embedding_fallback_base_url,
      embedding_fallback_api_key,
      embedding_fallback_model,
    )) => Ok(AiSettingsRecord {
      provider,
      api_key,
      model_id,
      base_url,
      context_max_history_tokens,
      embedding_model_id,
      retrieval_auto_inject,
      retrieval_max_tokens,
      embedding_fallback_base_url,
      embedding_fallback_api_key,
      embedding_fallback_model,
    }),
    Err(rusqlite::Error::QueryReturnedNoRows) => Ok(default_settings()),
    Err(e) => Err(e.to_string()),
  }
}

#[tauri::command]
pub fn ai_settings_set(app: AppHandle, settings: AiSettingsRecord) -> Result<(), String> {
  let provider = settings.provider.trim();
  if provider.is_empty() {
    return Err("Provider is required.".to_string());
  }
  let model_id = settings.model_id.trim();
  if model_id.is_empty() {
    return Err("Model is required.".to_string());
  }
  let api_key = settings.api_key.trim();
  if api_key.is_empty() {
    return Err("API key is required.".to_string());
  }
  let base_url = settings
    .base_url
    .as_ref()
    .map(|s| s.trim().to_string())
    .filter(|s| !s.is_empty());

  if provider == "openai_compatible" && base_url.is_none() {
    return Err("Base URL is required for OpenAI-compatible providers.".to_string());
  }

  let mut ctx_tokens = settings.context_max_history_tokens;
  if ctx_tokens < 4096 {
    ctx_tokens = 4096;
  }
  if ctx_tokens > 524_288 {
    ctx_tokens = 524_288;
  }

  let mut retrieval_max = settings.retrieval_max_tokens;
  if retrieval_max < 256 {
    retrieval_max = 256;
  }
  if retrieval_max > 32_768 {
    retrieval_max = 32_768;
  }

  let embedding_model_id = settings.embedding_model_id.trim().to_string();
  let retrieval_auto_inject = if settings.retrieval_auto_inject != 0 {
    1
  } else {
    0
  };
  let fb_url = settings
    .embedding_fallback_base_url
    .as_ref()
    .map(|s| s.trim().to_string())
    .filter(|s| !s.is_empty());
  let fb_key = settings
    .embedding_fallback_api_key
    .as_ref()
    .map(|s| s.trim().to_string())
    .filter(|s| !s.is_empty());
  let fb_model = settings
    .embedding_fallback_model
    .as_ref()
    .map(|s| s.trim().to_string())
    .filter(|s| !s.is_empty());

  let conn = db::open_connection(&app).map_err(|e| e.to_string())?;
  conn
    .execute(
      "INSERT OR REPLACE INTO ai_settings (
        id, provider, api_key, model_id, base_url, context_max_history_tokens,
        embedding_model_id, retrieval_auto_inject, retrieval_max_tokens,
        embedding_fallback_base_url, embedding_fallback_api_key, embedding_fallback_model
      ) VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
      rusqlite::params![
        provider,
        api_key,
        model_id,
        base_url,
        ctx_tokens,
        embedding_model_id,
        retrieval_auto_inject,
        retrieval_max,
        fb_url,
        fb_key,
        fb_model,
      ],
    )
    .map_err(|e| e.to_string())?;
  Ok(())
}
