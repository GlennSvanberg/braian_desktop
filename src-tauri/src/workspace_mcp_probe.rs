use std::io::Read;
use std::sync::mpsc;
use std::thread;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Map, Value};
use tauri::AppHandle;

use crate::braian_store::workspace_root_path;
use crate::db;
use crate::workspace_mcp_config::load_workspace_mcp_config;
use crate::workspace_mcp_http::{
  map_tools_to_summaries, remote_mcp_probe_tool_summaries, McpToolSummaryDto,
};
use crate::workspace_mcp_stdio::{
  read_response_for_id, spawn_stdio_server, start_stdout_line_channel, trim_stderr,
  write_json_line, MCP_RPC_DEADLINE, MCP_STDERR_CAP,
};

/// After `kill`, reap the child so stdio pipes close and reader threads can finish.
const PROBE_CHILD_WAIT: Duration = Duration::from_secs(12);
/// Avoid hanging the probe if a stdio helper thread never exits.
const PROBE_THREAD_JOIN: Duration = Duration::from_secs(4);

fn try_wait_child_bounded(child: &mut std::process::Child) {
  let start = Instant::now();
  while start.elapsed() < PROBE_CHILD_WAIT {
    match child.try_wait() {
      Ok(Some(_)) => return,
      Ok(None) => thread::sleep(Duration::from_millis(40)),
      Err(_) => return,
    }
  }
}

fn join_stdout_reader_bounded(handle: JoinHandle<()>) {
  let (tx, rx) = mpsc::channel::<()>();
  thread::spawn(move || {
    let _ = handle.join();
    let _ = tx.send(());
  });
  let _ = rx.recv_timeout(PROBE_THREAD_JOIN);
}

fn join_stderr_collector_bounded(handle: JoinHandle<String>) -> String {
  let (tx, rx) = mpsc::channel::<String>();
  thread::spawn(move || {
    let s = handle.join().unwrap_or_default();
    let _ = tx.send(s);
  });
  rx.recv_timeout(PROBE_THREAD_JOIN).unwrap_or_default()
}

fn cleanup_stdio_probe(
  child: &mut std::process::Child,
  reader: JoinHandle<()>,
  stderr_handle: JoinHandle<String>,
) -> String {
  let _ = child.kill();
  try_wait_child_bounded(child);
  join_stdout_reader_bounded(reader);
  join_stderr_collector_bounded(stderr_handle)
}

fn cleanup_stderr_only(child: &mut std::process::Child, stderr_handle: JoinHandle<String>) {
  let _ = child.kill();
  try_wait_child_bounded(child);
  let _ = join_stderr_collector_bounded(stderr_handle);
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpConnectionProbeResult {
  pub ok: bool,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub tool_count: Option<u32>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub error_message: Option<String>,
  /// `"stdio"` | `"remote"`
  pub transport: String,
  #[serde(default, skip_serializing_if = "Vec::is_empty")]
  pub tools: Vec<McpToolSummaryDto>,
}

fn probe_stdio(entry: &Map<String, Value>, workspace_root: &std::path::Path) -> McpConnectionProbeResult {
  let canon_root = match workspace_root.canonicalize() {
    Ok(p) => p,
    Err(e) => {
      return McpConnectionProbeResult {
        ok: false,
        tool_count: None,
        error_message: Some(format!("Workspace path: {e}")),
        transport: "stdio".to_string(),
        tools: vec![],
      };
    }
  };

  let mut child = match spawn_stdio_server(workspace_root, &canon_root, entry) {
    Ok(c) => c,
    Err(e) => {
      return McpConnectionProbeResult {
        ok: false,
        tool_count: None,
        error_message: Some(e),
        transport: "stdio".to_string(),
        tools: vec![],
      };
    }
  };

  let stderr_pipe = child.stderr.take();
  let stderr_handle = thread::spawn(move || {
    let mut out = String::new();
    if let Some(mut r) = stderr_pipe {
      let mut buf = [0u8; 2048];
      loop {
        match r.read(&mut buf) {
          Ok(0) => break,
          Ok(n) => {
            out.push_str(&String::from_utf8_lossy(&buf[..n]));
            if out.len() >= MCP_STDERR_CAP {
              break;
            }
          }
          Err(_) => break,
        }
      }
    }
    out
  });

  let stdout = match child.stdout.take() {
    Some(s) => s,
    None => {
      cleanup_stderr_only(&mut child, stderr_handle);
      return McpConnectionProbeResult {
        ok: false,
        tool_count: None,
        error_message: Some("No stdout from MCP process.".to_string()),
        transport: "stdio".to_string(),
        tools: vec![],
      };
    }
  };

  let mut stdin = match child.stdin.take() {
    Some(s) => s,
    None => {
      cleanup_stderr_only(&mut child, stderr_handle);
      return McpConnectionProbeResult {
        ok: false,
        tool_count: None,
        error_message: Some("No stdin to MCP process.".to_string()),
        transport: "stdio".to_string(),
        tools: vec![],
      };
    }
  };

  let (rx, reader) = start_stdout_line_channel(stdout);
  let deadline = Instant::now() + MCP_RPC_DEADLINE;

  let init_req = json!({
    "jsonrpc": "2.0",
    "id": 1_i64,
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": { "name": "braian-desktop", "version": "0.1.0" }
    }
  });

  if let Err(e) = write_json_line(&mut stdin, &init_req) {
    let _ = cleanup_stdio_probe(&mut child, reader, stderr_handle);
    return McpConnectionProbeResult {
      ok: false,
      tool_count: None,
      error_message: Some(e),
      transport: "stdio".to_string(),
      tools: vec![],
    };
  }

  let init_res = match read_response_for_id(&rx, deadline, 1) {
    Ok(v) => v,
    Err(e) => {
      let stderr = cleanup_stdio_probe(&mut child, reader, stderr_handle);
      return McpConnectionProbeResult {
        ok: false,
        tool_count: None,
        error_message: Some(format!("{e} {}", trim_stderr(&stderr))),
        transport: "stdio".to_string(),
        tools: vec![],
      };
    }
  };

  if let Some(err) = init_res.get("error") {
    let stderr = cleanup_stdio_probe(&mut child, reader, stderr_handle);
    let msg = err
      .get("message")
      .and_then(|m| m.as_str())
      .unwrap_or("initialize failed");
    return McpConnectionProbeResult {
      ok: false,
      tool_count: None,
      error_message: Some(format!("{msg}. {}", trim_stderr(&stderr))),
      transport: "stdio".to_string(),
      tools: vec![],
    };
  }

  let notif = json!({
    "jsonrpc": "2.0",
    "method": "notifications/initialized"
  });
  if let Err(e) = write_json_line(&mut stdin, &notif) {
    let stderr = cleanup_stdio_probe(&mut child, reader, stderr_handle);
    return McpConnectionProbeResult {
      ok: false,
      tool_count: None,
      error_message: Some(format!("{e} {}", trim_stderr(&stderr))),
      transport: "stdio".to_string(),
      tools: vec![],
    };
  }

  let list_req = json!({
    "jsonrpc": "2.0",
    "id": 2_i64,
    "method": "tools/list",
    "params": {}
  });

  if let Err(e) = write_json_line(&mut stdin, &list_req) {
    let stderr = cleanup_stdio_probe(&mut child, reader, stderr_handle);
    return McpConnectionProbeResult {
      ok: false,
      tool_count: None,
      error_message: Some(format!("{e} {}", trim_stderr(&stderr))),
      transport: "stdio".to_string(),
      tools: vec![],
    };
  }

  let list_res = match read_response_for_id(&rx, deadline, 2) {
    Ok(v) => v,
    Err(e) => {
      let stderr = cleanup_stdio_probe(&mut child, reader, stderr_handle);
      return McpConnectionProbeResult {
        ok: false,
        tool_count: None,
        error_message: Some(format!("{e} {}", trim_stderr(&stderr))),
        transport: "stdio".to_string(),
        tools: vec![],
      };
    }
  };

  let stderr = cleanup_stdio_probe(&mut child, reader, stderr_handle);

  if let Some(err) = list_res.get("error") {
    let msg = err
      .get("message")
      .and_then(|m| m.as_str())
      .unwrap_or("tools/list failed");
    return McpConnectionProbeResult {
      ok: false,
      tool_count: None,
      error_message: Some(format!("{msg}. {}", trim_stderr(&stderr))),
      transport: "stdio".to_string(),
      tools: vec![],
    };
  }

  let tools_arr = list_res
    .get("result")
    .and_then(|r| r.get("tools"))
    .and_then(|t| t.as_array())
    .cloned()
    .unwrap_or_default();
  let tools = map_tools_to_summaries(&tools_arr);
  let tool_count = Some(tools.len() as u32);

  McpConnectionProbeResult {
    ok: true,
    tool_count,
    error_message: None,
    transport: "stdio".to_string(),
    tools,
  }
}

fn probe_remote(entry: &Map<String, Value>) -> McpConnectionProbeResult {
  match remote_mcp_probe_tool_summaries(entry) {
    Ok((n, tools)) => McpConnectionProbeResult {
      ok: true,
      tool_count: Some(n),
      error_message: None,
      transport: "remote".to_string(),
      tools,
    },
    Err(e) => McpConnectionProbeResult {
      ok: false,
      tool_count: None,
      error_message: Some(e),
      transport: "remote".to_string(),
      tools: vec![],
    },
  }
}

fn workspace_mcp_probe_connection_sync(
  app: AppHandle,
  workspace_id: String,
  name: String,
) -> Result<McpConnectionProbeResult, String> {
  let cfg = load_workspace_mcp_config(&app, &workspace_id)?;
  let entry_val = cfg
    .mcp_servers
    .get(&name)
    .ok_or_else(|| format!("Unknown server \"{name}\"."))?;

  let entry = entry_val
    .as_object()
    .ok_or_else(|| "Server entry must be a JSON object.".to_string())?;

  let url = entry
    .get("url")
    .and_then(|u| u.as_str())
    .unwrap_or("")
    .trim();
  let command = entry
    .get("command")
    .and_then(|c| c.as_str())
    .unwrap_or("")
    .trim();

  let conn = db::open_connection(&app).map_err(|e| e.to_string())?;
  let root = workspace_root_path(&conn, &workspace_id)?;

  let result = if !url.is_empty() {
    probe_remote(entry)
  } else if !command.is_empty() {
    probe_stdio(entry, &root)
  } else {
    McpConnectionProbeResult {
      ok: false,
      tool_count: None,
      error_message: Some("Need command (stdio) or url (remote).".to_string()),
      transport: "unknown".to_string(),
      tools: vec![],
    }
  };

  Ok(result)
}

/// Runs the MCP handshake on a blocking thread pool so a slow or stuck server
/// cannot freeze the async runtime that also drives other desktop IPC.
#[tauri::command]
pub async fn workspace_mcp_probe_connection(
  app: AppHandle,
  workspace_id: String,
  server_name: String,
) -> Result<McpConnectionProbeResult, String> {
  let name = server_name.trim().to_string();
  if name.is_empty() {
    return Err("Server name is required.".to_string());
  }

  let app = app.clone();
  tauri::async_runtime::spawn_blocking(move || {
    workspace_mcp_probe_connection_sync(app, workspace_id, name)
  })
  .await
  .map_err(|e| format!("Connection check task failed: {e}"))?
}
