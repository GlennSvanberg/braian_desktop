use std::fs;
use std::path::{Path, PathBuf};

use braian_mcp_core::config::load_workspace_mcp_config as core_load_workspace_mcp_config;
pub use braian_mcp_core::config::WorkspaceMcpConfigDto;
use tauri::AppHandle;

use crate::braian_store::{ensure_braian_layout, workspace_root_path};
use crate::db;

fn mcp_json_path(workspace_root: &Path) -> PathBuf {
  workspace_root.join(".braian").join("mcp.json")
}

pub(crate) fn load_workspace_mcp_config(
  app: &AppHandle,
  workspace_id: &str,
) -> Result<WorkspaceMcpConfigDto, String> {
  let conn = db::open_connection(app).map_err(|e| e.to_string())?;
  let root = workspace_root_path(&conn, workspace_id)?;
  core_load_workspace_mcp_config(&root)
}

#[tauri::command]
pub fn workspace_mcp_config_get(
  app: AppHandle,
  workspace_id: String,
) -> Result<WorkspaceMcpConfigDto, String> {
  load_workspace_mcp_config(&app, &workspace_id)
}

#[tauri::command]
pub fn workspace_mcp_config_set(
  app: AppHandle,
  workspace_id: String,
  config: WorkspaceMcpConfigDto,
) -> Result<(), String> {
  let conn = db::open_connection(&app).map_err(|e| e.to_string())?;
  let root = workspace_root_path(&conn, &workspace_id)?;
  ensure_braian_layout(&root)?;
  let path = mcp_json_path(&root);
  let json = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
  fs::write(&path, format!("{json}\n")).map_err(|e| e.to_string())?;
  let _ = core_load_workspace_mcp_config(&root)?;
  Ok(())
}
