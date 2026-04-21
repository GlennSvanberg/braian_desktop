//! Workspace hub: manifest-driven dashboard data under `.braian/` (dashboard.json,
//! arrow-apps.json, recent-files.json, insights.json).

use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::braian_store::{ensure_braian_layout, workspace_root_path};
use crate::db;

const DASHBOARD_JSON: &str = ".braian/dashboard.json";
const ARROW_APPS_JSON: &str = ".braian/arrow-apps.json";
const RECENT_FILES_JSON: &str = ".braian/recent-files.json";
const INSIGHTS_JSON: &str = ".braian/insights.json";
const RECENT_MAX: usize = 50;

fn now_ms() -> i64 {
  std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map(|d| d.as_millis() as i64)
    .unwrap_or(0)
}

fn should_skip_recent_touch(relative_path: &str) -> bool {
  let p = relative_path.replace('\\', "/");
  matches!(
    p.as_str(),
    ".braian/recent-files.json" | ".braian/hub-recent-apps.json"
  )
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HubDashboardSection {
  pub id: String,
  #[serde(rename = "type")]
  pub section_type: String,
  #[serde(default = "default_true")]
  pub enabled: bool,
}

fn default_true() -> bool {
  true
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HubDashboardManifest {
  pub schema_version: u32,
  #[serde(default)]
  pub sections: Vec<HubDashboardSection>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebappAppRouteDto {
  pub path: String,
  pub label: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArrowAppIndexEntry {
  id: String,
  #[serde(default)]
  title: String,
  #[allow(dead_code)]
  #[serde(default)]
  updated_at_ms: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArrowAppsIndexFile {
  #[serde(default)]
  schema_version: u32,
  #[serde(default)]
  apps: Vec<ArrowAppIndexEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentFileEntryDto {
  pub relative_path: String,
  pub last_accessed_at_ms: i64,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentFilesFile {
  pub schema_version: u32,
  #[serde(default)]
  pub entries: Vec<RecentFileEntryDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HubInsightItemDto {
  pub id: String,
  pub text: String,
  pub created_at_ms: i64,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub conversation_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HubInsightsFile {
  pub schema_version: u32,
  #[serde(default)]
  pub items: Vec<HubInsightItemDto>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceHubSnapshot {
  #[serde(skip_serializing_if = "Option::is_none")]
  pub dashboard: Option<HubDashboardManifest>,
  pub webapp_app_routes: Vec<WebappAppRouteDto>,
  pub recent_files: Vec<RecentFileEntryDto>,
  pub insight_items: Vec<HubInsightItemDto>,
}

fn read_arrow_apps_as_routes(root: &Path) -> Vec<WebappAppRouteDto> {
  let manifest_path = root.join(ARROW_APPS_JSON);
  let Ok(raw) = fs::read_to_string(&manifest_path) else {
    return vec![];
  };
  let Ok(m) = serde_json::from_str::<ArrowAppsIndexFile>(&raw) else {
    return vec![];
  };
  if m.schema_version != 1 {
    return vec![];
  }
  m.apps
    .into_iter()
    .filter(|a| !a.id.trim().is_empty())
    .map(|a| {
      let id = a.id.trim().to_string();
      let path = if id.starts_with('/') {
        id.clone()
      } else {
        format!("/{id}")
      };
      let label = if a.title.trim().is_empty() {
        id.clone()
      } else {
        a.title.trim().to_string()
      };
      WebappAppRouteDto { path, label }
    })
    .collect()
}

fn read_dashboard(root: &Path) -> Option<HubDashboardManifest> {
  let p = root.join(DASHBOARD_JSON);
  let raw = fs::read_to_string(&p).ok()?;
  serde_json::from_str(&raw).ok()
}

fn read_recent_files(root: &Path) -> Vec<RecentFileEntryDto> {
  let p = root.join(RECENT_FILES_JSON);
  let Ok(raw) = fs::read_to_string(&p) else {
    return vec![];
  };
  let Ok(f) = serde_json::from_str::<RecentFilesFile>(&raw) else {
    return vec![];
  };
  f.entries
}

fn read_insights(root: &Path) -> Vec<HubInsightItemDto> {
  let p = root.join(INSIGHTS_JSON);
  let Ok(raw) = fs::read_to_string(&p) else {
    return vec![];
  };
  let Ok(f) = serde_json::from_str::<HubInsightsFile>(&raw) else {
    return vec![];
  };
  f.items
}

#[tauri::command]
pub fn workspace_hub_snapshot(
  app: AppHandle,
  workspace_id: String,
) -> Result<WorkspaceHubSnapshot, String> {
  let conn = db::open_connection(&app).map_err(|e| e.to_string())?;
  let root = workspace_root_path(&conn, &workspace_id)?;
  let dashboard = read_dashboard(&root);
  let webapp_app_routes = read_arrow_apps_as_routes(&root);
  let recent_files = read_recent_files(&root);
  let insight_items = read_insights(&root);
  Ok(WorkspaceHubSnapshot {
    dashboard,
    webapp_app_routes,
    recent_files,
    insight_items,
  })
}

pub fn recent_file_touch_internal(
  workspace_root: &Path,
  relative_path: &str,
  label: Option<&str>,
) -> Result<(), String> {
  let rel = relative_path.trim().replace('\\', "/");
  if rel.is_empty() || rel.contains('\0') {
    return Err("Invalid path.".to_string());
  }
  if should_skip_recent_touch(&rel) {
    return Ok(());
  }
  ensure_braian_layout(workspace_root)?;
  let path = workspace_root.join(RECENT_FILES_JSON);
  let mut entries = if path.is_file() {
    fs::read_to_string(&path)
      .ok()
      .and_then(|s| serde_json::from_str::<RecentFilesFile>(&s).ok())
      .map(|f| f.entries)
      .unwrap_or_default()
  } else {
    vec![]
  };

  entries.retain(|e| e.relative_path != rel);
  entries.insert(
    0,
    RecentFileEntryDto {
      relative_path: rel,
      last_accessed_at_ms: now_ms(),
      label: label.map(|s| s.to_string()).filter(|s| !s.is_empty()),
    },
  );
  if entries.len() > RECENT_MAX {
    entries.truncate(RECENT_MAX);
  }

  let doc = RecentFilesFile {
    schema_version: 1,
    entries,
  };
  let json = serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())?;
  fs::write(&path, format!("{json}\n")).map_err(|e| e.to_string())?;
  Ok(())
}

/// Called after workspace text file writes (and from TS when user attaches a file).
#[tauri::command]
pub fn workspace_hub_recent_file_touch(
  app: AppHandle,
  workspace_id: String,
  relative_path: String,
  label: Option<String>,
) -> Result<(), String> {
  let conn = db::open_connection(&app).map_err(|e| e.to_string())?;
  let root = workspace_root_path(&conn, &workspace_id)?;
  recent_file_touch_internal(&root, &relative_path, label.as_deref())
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::io::Write;

  #[test]
  fn read_arrow_apps_maps_paths() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join(ARROW_APPS_JSON);
    let mut f = fs::File::create(&p).unwrap();
    writeln!(
      f,
      r#"{{"schemaVersion":1,"apps":[{{"id":"calc","title":"Calculator","updatedAtMs":1}}]}}"#
    )
    .unwrap();
    let routes = read_arrow_apps_as_routes(dir.path());
    assert_eq!(routes.len(), 1);
    assert_eq!(routes[0].path, "/calc");
    assert_eq!(routes[0].label, "Calculator");
  }
}
