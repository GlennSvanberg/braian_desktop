use std::io::Read;
use std::thread;
use std::time::Instant;

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
      let _ = child.kill();
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
      let _ = child.kill();
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
    let _ = child.kill();
    let _ = reader.join();
    let _ = stderr_handle.join();
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
      let _ = child.kill();
      let _ = reader.join();
      let stderr = stderr_handle.join().unwrap_or_default();
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
    let _ = child.kill();
    let _ = reader.join();
    let stderr = stderr_handle.join().unwrap_or_default();
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
    let _ = child.kill();
    let _ = reader.join();
    let stderr = stderr_handle.join().unwrap_or_default();
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
    let _ = child.kill();
    let _ = reader.join();
    let stderr = stderr_handle.join().unwrap_or_default();
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
      let _ = child.kill();
      let _ = reader.join();
      let stderr = stderr_handle.join().unwrap_or_default();
      return McpConnectionProbeResult {
        ok: false,
        tool_count: None,
        error_message: Some(format!("{e} {}", trim_stderr(&stderr))),
        transport: "stdio".to_string(),
        tools: vec![],
      };
    }
  };

  let _ = child.kill();
  let _ = child.wait();
  let _ = reader.join();
  let stderr = stderr_handle.join().unwrap_or_default();

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

#[tauri::command]
pub fn workspace_mcp_probe_connection(
  app: AppHandle,
  workspace_id: String,
  server_name: String,
) -> Result<McpConnectionProbeResult, String> {
  let name = server_name.trim();
  if name.is_empty() {
    return Err("Server name is required.".to_string());
  }

  let cfg = load_workspace_mcp_config(&app, &workspace_id)?;
  let entry_val = cfg
    .mcp_servers
    .get(name)
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
