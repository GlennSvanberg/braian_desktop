//! Workspace hub: manifest-driven dashboard data under `.braian/` (dashboard.json,
//! webapp-apps.json, recent-files.json, insights.json).

use std::fs;
use std::path::Path;

use regex::Regex;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::braian_store::{ensure_braian_layout, workspace_root_path};
use crate::db;

const DASHBOARD_JSON: &str = ".braian/dashboard.json";
const WEBAPP_APPS_JSON: &str = ".braian/webapp-apps.json";
const RECENT_FILES_JSON: &str = ".braian/recent-files.json";
const INSIGHTS_JSON: &str = ".braian/insights.json";
const APP_ROUTES_TSX: &str = ".braian/webapp/src/app-routes.tsx";
const RECENT_MAX: usize = 50;

fn now_ms() -> i64 {
  std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map(|d| d.as_millis() as i64)
    .unwrap_or(0)
}

fn should_skip_recent_touch(relative_path: &str) -> bool {
  let p = relative_path.replace('\\', "/");
  p == ".braian/recent-files.json"
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebappAppsManifestFile {
  pub schema_version: u32,
  pub generated_at_ms: i64,
  #[serde(default)]
  pub routes: Vec<WebappAppRouteDto>,
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

/// Extract `path` / `label` pairs from `app-routes.tsx` source (APP_ROUTES entries).
pub fn parse_app_routes_from_tsx(content: &str) -> Vec<WebappAppRouteDto> {
  let re = Regex::new(
    r#"path:\s*['"]([^'"]+)['"]\s*,\s*label:\s*['"]([^'"]+)['"]"#,
  )
  .expect("valid regex");
  re.captures_iter(content)
    .filter_map(|c| {
      let path = c.get(1)?.as_str().to_string();
      let label = c.get(2)?.as_str().to_string();
      if path.is_empty() || label.is_empty() {
        return None;
      }
      Some(WebappAppRouteDto { path, label })
    })
    .collect()
}

fn read_webapp_apps_from_disk(root: &Path) -> Vec<WebappAppRouteDto> {
  let manifest_path = root.join(WEBAPP_APPS_JSON);
  if let Ok(raw) = fs::read_to_string(&manifest_path) {
    if let Ok(m) = serde_json::from_str::<WebappAppsManifestFile>(&raw) {
      if !m.routes.is_empty() {
        return m.routes;
      }
    }
  }
  let tsx = root.join(APP_ROUTES_TSX);
  let Ok(raw) = fs::read_to_string(&tsx) else {
    return vec![];
  };
  parse_app_routes_from_tsx(&raw)
}

/// Writes `.braian/webapp-apps.json` from current `app-routes.tsx` (and timestamps).
pub fn write_webapp_apps_manifest(workspace_root: &Path) -> Result<(), String> {
  ensure_braian_layout(workspace_root)?;
  let tsx = workspace_root.join(APP_ROUTES_TSX);
  let routes = if tsx.is_file() {
    let raw = fs::read_to_string(&tsx).map_err(|e| e.to_string())?;
    parse_app_routes_from_tsx(&raw)
  } else {
    vec![]
  };
  let file = WebappAppsManifestFile {
    schema_version: 1,
    generated_at_ms: now_ms(),
    routes,
  };
  let path = workspace_root.join(WEBAPP_APPS_JSON);
  let json = serde_json::to_string_pretty(&file).map_err(|e| e.to_string())?;
  fs::write(&path, format!("{json}\n")).map_err(|e| e.to_string())?;
  Ok(())
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
  let webapp_app_routes = read_webapp_apps_from_disk(&root);
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

  #[test]
  fn parse_app_routes_extracts_pairs() {
    let src = r#"
export const APP_ROUTES = [
  {
    path: '/calculator',
    label: 'Calculator',
    element: <X />,
  },
  {
    path: '/email-checker',
    label: 'Email checker',
    element: <Y />,
  },
]
"#;
    let r = parse_app_routes_from_tsx(src);
    assert_eq!(r.len(), 2);
    assert_eq!(r[0].path, "/calculator");
    assert_eq!(r[0].label, "Calculator");
    assert_eq!(r[1].path, "/email-checker");
  }
}
