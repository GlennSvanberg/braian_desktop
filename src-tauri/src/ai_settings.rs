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
}

fn default_settings() -> AiSettingsRecord {
  AiSettingsRecord {
    provider: "openai".to_string(),
    api_key: String::new(),
    model_id: "gpt-5.4".to_string(),
    base_url: None,
  }
}

#[tauri::command]
pub fn ai_settings_get(app: AppHandle) -> Result<AiSettingsRecord, String> {
  let conn = db::open_connection(&app).map_err(|e| e.to_string())?;
  let row: Result<(String, String, String, Option<String>), rusqlite::Error> = conn.query_row(
    "SELECT provider, api_key, model_id, base_url FROM ai_settings WHERE id = 1",
    [],
    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
  );
  match row {
    Ok((provider, api_key, model_id, base_url)) => Ok(AiSettingsRecord {
      provider,
      api_key,
      model_id,
      base_url,
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

  let conn = db::open_connection(&app).map_err(|e| e.to_string())?;
  conn
    .execute(
      "INSERT OR REPLACE INTO ai_settings (id, provider, api_key, model_id, base_url)
       VALUES (1, ?1, ?2, ?3, ?4)",
      rusqlite::params![provider, api_key, model_id, base_url],
    )
    .map_err(|e| e.to_string())?;
  Ok(())
}
