use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};

use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::braian_store::workspace_root_path;
use crate::db;

type SharedChild = Mutex<Option<Child>>;

fn broker_child() -> &'static SharedChild {
  static CHILD: OnceLock<SharedChild> = OnceLock::new();
  CHILD.get_or_init(|| Mutex::new(None))
}

#[derive(Clone)]
struct BrokerAddr {
  base_url: String,
  token: String,
}

fn broker_addr() -> &'static Mutex<Option<BrokerAddr>> {
  static ADDR: OnceLock<Mutex<Option<BrokerAddr>>> = OnceLock::new();
  ADDR.get_or_init(|| Mutex::new(None))
}

fn random_token() -> String {
  use std::time::{SystemTime, UNIX_EPOCH};
  let now = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|d| d.as_nanos())
    .unwrap_or(0);
  format!("braian-mcpd-{now:x}")
}

fn pick_port() -> Result<u16, String> {
  let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|e| e.to_string())?;
  let port = listener.local_addr().map_err(|e| e.to_string())?.port();
  drop(listener);
  Ok(port)
}

fn broker_binary_path() -> Option<PathBuf> {
  let exe = std::env::current_exe().ok()?;
  let dir = exe.parent()?;
  let candidate = if cfg!(windows) {
    dir.join("braian-mcpd.exe")
  } else {
    dir.join("braian-mcpd")
  };
  if candidate.is_file() {
    return Some(candidate);
  }
  let dev_target = dir
    .join("..")
    .join("debug")
    .join(if cfg!(windows) {
      "braian-mcpd.exe"
    } else {
      "braian-mcpd"
    });
  if dev_target.is_file() {
    return Some(dev_target);
  }
  None
}

fn cargo_workspace_root() -> Option<PathBuf> {
  let mut cur = std::env::current_exe().ok()?.parent()?.to_path_buf();
  for _ in 0..8 {
    if cur.join("Cargo.toml").is_file() {
      return Some(cur);
    }
    let parent = cur.parent()?.to_path_buf();
    cur = parent;
  }
  None
}

fn ensure_broker_running() -> Result<BrokerAddr, String> {
  if let Ok(g) = broker_addr().lock() {
    if let Some(addr) = &*g {
      return Ok(addr.clone());
    }
  }

  let port = pick_port()?;
  let token = random_token();
  let mut cmd = if let Some(bin) = broker_binary_path() {
    let mut c = Command::new(bin);
    c.arg("--port")
      .arg(port.to_string())
      .arg("--token")
      .arg(&token);
    c
  } else if cfg!(debug_assertions) {
    let mut c = Command::new("cargo");
    c.arg("run")
      .arg("-p")
      .arg("braian-mcpd")
      .arg("--")
      .arg("--port")
      .arg(port.to_string())
      .arg("--token")
      .arg(&token);
    if let Some(root) = cargo_workspace_root() {
      c.current_dir(root);
    }
    c
  } else {
    return Err("Could not locate braian-mcpd binary.".to_string());
  };
  cmd.stdin(Stdio::null());
  // .stdout(Stdio::null())
  // .stderr(Stdio::null());
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    cmd.creation_flags(CREATE_NO_WINDOW);
  }
  let child = cmd
    .spawn()
    .map_err(|e| format!("Failed to start braian-mcpd: {e}"))?;
  {
    let mut g = broker_child()
      .lock()
      .map_err(|_| "MCP broker lock poisoned.".to_string())?;
    *g = Some(child);
  }
  let addr = BrokerAddr {
    base_url: format!("http://127.0.0.1:{port}"),
    token,
  };
  {
    let mut g = broker_addr()
      .lock()
      .map_err(|_| "MCP broker addr lock poisoned.".to_string())?;
    *g = Some(addr.clone());
  }
  Ok(addr)
}

fn post_json<T: DeserializeOwned>(path: &str, body: Value) -> Result<T, String> {
  let addr = ensure_broker_running()?;
  let url = format!("{}{}", addr.base_url, path);
  let body_str = serde_json::to_string(&body).map_err(|e| e.to_string())?;
  let resp = ureq::post(&url)
    .timeout(std::time::Duration::from_secs(30))
    .set("Content-Type", "application/json; charset=utf-8")
    .set("X-Braian-Mcpd-Token", &addr.token)
    .send_string(&body_str)
    .map_err(|e| e.to_string())?;
  if !(200..300).contains(&resp.status()) {
    return Err(format!("mcpd HTTP {}", resp.status()));
  }
  let text = resp.into_string().map_err(|e| e.to_string())?;
  serde_json::from_str::<T>(&text).map_err(|e| e.to_string())
}

fn workspace_root_for_id(app: &AppHandle, workspace_id: &str) -> Result<String, String> {
  let conn = db::open_connection(app).map_err(|e| e.to_string())?;
  let root = workspace_root_path(&conn, workspace_id)?;
  Ok(root.to_string_lossy().to_string())
}

#[derive(Debug, Serialize, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpListToolsServerDto {
  pub name: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub description: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub error: Option<String>,
  #[serde(default)]
  pub tools: Vec<Value>,
}

#[derive(Debug, Serialize, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpListToolsResultDto {
  pub servers: Vec<McpListToolsServerDto>,
}

#[tauri::command]
pub async fn workspace_mcp_list_tools(
  app: AppHandle,
  workspace_id: String,
  server_names: Option<Vec<String>>,
) -> Result<McpListToolsResultDto, String> {
  let root = workspace_root_for_id(&app, &workspace_id)?;
  tauri::async_runtime::spawn_blocking(move || {
    post_json::<McpListToolsResultDto>(
      "/v1/list-tools",
      json!({
        "workspaceRootPath": root,
        "serverNames": server_names.unwrap_or_default(),
      }),
    )
  })
  .await
  .map_err(|e| format!("MCP broker task failed: {e}"))?
}

#[tauri::command]
pub async fn workspace_mcp_call_tool(
  app: AppHandle,
  workspace_id: String,
  server_name: String,
  tool_name: String,
  arguments: Value,
) -> Result<String, String> {
  #[derive(serde::Deserialize)]
  #[serde(rename_all = "camelCase")]
  struct CallToolResponse {
    text: String,
  }
  let root = workspace_root_for_id(&app, &workspace_id)?;
  let r = tauri::async_runtime::spawn_blocking(move || {
    post_json::<CallToolResponse>(
      "/v1/call-tool",
      json!({
        "workspaceRootPath": root,
        "serverName": server_name,
        "toolName": tool_name,
        "arguments": arguments,
      }),
    )
  })
  .await
  .map_err(|e| format!("MCP broker task failed: {e}"))??;
  Ok(r.text)
}

#[tauri::command]
pub async fn workspace_mcp_sessions_disconnect(
  app: AppHandle,
  workspace_id: String,
) -> Result<(), String> {
  let root = workspace_root_for_id(&app, &workspace_id)?;
  let _: Value = tauri::async_runtime::spawn_blocking(move || {
    post_json::<Value>(
      "/v1/disconnect",
      json!({
        "workspaceRootPath": root,
      }),
    )
  })
  .await
  .map_err(|e| format!("MCP broker task failed: {e}"))??;
  Ok(())
}

#[derive(Debug, Serialize, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolProbeSummary {
  pub name: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub description: Option<String>,
}

#[derive(Debug, Serialize, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpConnectionProbeResult {
  pub ok: bool,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub tool_count: Option<u32>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub error_message: Option<String>,
  pub transport: String,
  #[serde(default)]
  pub tools: Vec<McpToolProbeSummary>,
}

#[tauri::command]
pub async fn workspace_mcp_probe_connection(
  app: AppHandle,
  workspace_id: String,
  server_name: String,
) -> Result<McpConnectionProbeResult, String> {
  let root = workspace_root_for_id(&app, &workspace_id)?;
  tauri::async_runtime::spawn_blocking(move || {
    post_json::<McpConnectionProbeResult>(
      "/v1/probe",
      json!({
        "workspaceRootPath": root,
        "serverName": server_name,
      }),
    )
  })
  .await
  .map_err(|e| format!("MCP broker task failed: {e}"))?
}

pub fn workspace_mcp_broker_shutdown() {
  if let Ok(mut g) = broker_child().lock() {
    if let Some(mut child) = g.take() {
      let _ = child.kill();
      let _ = child.wait();
    }
  }
  if let Ok(mut a) = broker_addr().lock() {
    *a = None;
  }
}
