use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Map, Value};
use tauri::AppHandle;

use crate::braian_store::workspace_root_path;
use crate::db;
use crate::workspace_files::safe_join_workspace;
use crate::workspace_mcp_config::load_workspace_mcp_config;

const PROBE_DEADLINE: Duration = Duration::from_secs(25);
const STDERR_CAP: usize = 12_000;

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
}

fn resolve_stdio_cwd(
  workspace_root: &std::path::Path,
  canon_root: &std::path::Path,
  entry: &Map<String, Value>,
) -> Result<std::path::PathBuf, String> {
  let rel = entry
    .get("cwd")
    .and_then(|v| v.as_str())
    .map(str::trim)
    .filter(|s| !s.is_empty());
  match rel {
    None => Ok(canon_root.to_path_buf()),
    Some(r) => {
      let p = safe_join_workspace(workspace_root, r)?;
      let meta = fs::metadata(&p).map_err(|e| e.to_string())?;
      if !meta.is_dir() {
        return Err("cwd is not a directory.".to_string());
      }
      let c = p.canonicalize().map_err(|e| e.to_string())?;
      if !c.starts_with(canon_root) {
        return Err("cwd escapes workspace.".to_string());
      }
      Ok(c)
    }
  }
}

fn spawn_stdio_server(
  workspace_root: &std::path::Path,
  canon_root: &std::path::Path,
  entry: &Map<String, Value>,
) -> Result<std::process::Child, String> {
  let command = entry
    .get("command")
    .and_then(|v| v.as_str())
    .map(str::trim)
    .filter(|s| !s.is_empty())
    .ok_or_else(|| "Missing command.".to_string())?;

  let args: Vec<String> = entry
    .get("args")
    .and_then(|a| a.as_array())
    .map(|arr| {
      arr
        .iter()
        .filter_map(|v| v.as_str().map(str::to_string))
        .collect()
    })
    .unwrap_or_default();

  let cwd_path = resolve_stdio_cwd(workspace_root, canon_root, entry)?;

  let mut cmd = Command::new(command);
  cmd.args(&args);
  cmd.current_dir(&cwd_path);
  cmd.stdin(Stdio::piped());
  cmd.stdout(Stdio::piped());
  cmd.stderr(Stdio::piped());

  if let Some(env_obj) = entry.get("env").and_then(|e| e.as_object()) {
    for (k, v) in env_obj {
      if let Some(s) = v.as_str() {
        cmd.env(k, s);
      }
    }
  }

  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    cmd.creation_flags(CREATE_NO_WINDOW);
  }

  cmd
    .spawn()
    .map_err(|e| format!("Failed to start `{command}`: {e}"))
}

fn read_response_for_id(
  rx: &mpsc::Receiver<String>,
  deadline: Instant,
  want_id: i64,
) -> Result<Value, String> {
  loop {
    let remaining = deadline.saturating_duration_since(Instant::now());
    if remaining.is_zero() {
      return Err("Timed out waiting for MCP response.".to_string());
    }
    let wait = remaining.min(Duration::from_secs(3));
    let line = match rx.recv_timeout(wait) {
      Ok(l) => l,
      Err(mpsc::RecvTimeoutError::Timeout) => continue,
      Err(mpsc::RecvTimeoutError::Disconnected) => {
        return Err("MCP process closed stdout before responding.".to_string());
      }
    };
    let line = line.trim();
    if line.is_empty() {
      continue;
    }
    let v: Value = serde_json::from_str(line)
      .map_err(|e| format!("Non-JSON line from MCP: {e}: {}", line.chars().take(200).collect::<String>()))?;
    if let Some(id) = v.get("id").and_then(|i| i.as_i64()) {
      if id == want_id {
        return Ok(v);
      }
    }
  }
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
            if out.len() >= STDERR_CAP {
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
      };
    }
  };

  let (tx, rx) = mpsc::channel::<String>();
  let reader = thread::spawn(move || {
    let reader = BufReader::new(stdout);
    for line in reader.lines().map_while(Result::ok) {
      if tx.send(line).is_err() {
        break;
      }
    }
  });

  let deadline = Instant::now() + PROBE_DEADLINE;

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

  let init_line = match serde_json::to_string(&init_req) {
    Ok(s) => s,
    Err(e) => {
      let _ = child.kill();
      return McpConnectionProbeResult {
        ok: false,
        tool_count: None,
        error_message: Some(e.to_string()),
        transport: "stdio".to_string(),
      };
    }
  };

  if writeln!(stdin, "{}", init_line).is_err() || stdin.flush().is_err() {
    let _ = child.kill();
    let stderr = stderr_handle.join().unwrap_or_default();
    return McpConnectionProbeResult {
      ok: false,
      tool_count: None,
      error_message: Some(format!(
        "Could not write to MCP stdin. {}",
        trim_stderr(&stderr)
      )),
      transport: "stdio".to_string(),
    };
  }

  let init_res = match read_response_for_id(&rx, deadline, 1) {
    Ok(v) => v,
    Err(e) => {
      let _ = child.kill();
      let stderr = stderr_handle.join().unwrap_or_default();
      return McpConnectionProbeResult {
        ok: false,
        tool_count: None,
        error_message: Some(format!("{e} {}", trim_stderr(&stderr))),
        transport: "stdio".to_string(),
      };
    }
  };

  if let Some(err) = init_res.get("error") {
    let _ = child.kill();
    let stderr = stderr_handle.join().unwrap_or_default();
    let msg = err
      .get("message")
      .and_then(|m| m.as_str())
      .unwrap_or("initialize failed");
    return McpConnectionProbeResult {
      ok: false,
      tool_count: None,
      error_message: Some(format!(
        "{msg}. {}",
        trim_stderr(&stderr)
      )),
      transport: "stdio".to_string(),
    };
  }

  let notif = json!({
    "jsonrpc": "2.0",
    "method": "notifications/initialized"
  });
  if writeln!(stdin, "{}", serde_json::to_string(&notif).unwrap_or_default()).is_err()
    || stdin.flush().is_err()
  {
    let _ = child.kill();
    let stderr = stderr_handle.join().unwrap_or_default();
    return McpConnectionProbeResult {
      ok: false,
      tool_count: None,
      error_message: Some(format!(
        "Could not send initialized notification. {}",
        trim_stderr(&stderr)
      )),
      transport: "stdio".to_string(),
    };
  }

  let list_req = json!({
    "jsonrpc": "2.0",
    "id": 2_i64,
    "method": "tools/list",
    "params": {}
  });

  if writeln!(stdin, "{}", serde_json::to_string(&list_req).unwrap_or_default()).is_err()
    || stdin.flush().is_err()
  {
    let _ = child.kill();
    let stderr = stderr_handle.join().unwrap_or_default();
    return McpConnectionProbeResult {
      ok: false,
      tool_count: None,
      error_message: Some(format!(
        "Could not request tools/list. {}",
        trim_stderr(&stderr)
      )),
      transport: "stdio".to_string(),
    };
  }

  let list_res = match read_response_for_id(&rx, deadline, 2) {
    Ok(v) => v,
    Err(e) => {
      let _ = child.kill();
      let stderr = stderr_handle.join().unwrap_or_default();
      return McpConnectionProbeResult {
        ok: false,
        tool_count: None,
        error_message: Some(format!("{e} {}", trim_stderr(&stderr))),
        transport: "stdio".to_string(),
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
      error_message: Some(format!(
        "{msg}. {}",
        trim_stderr(&stderr)
      )),
      transport: "stdio".to_string(),
    };
  }

  let tool_count = list_res
    .get("result")
    .and_then(|r| r.get("tools"))
    .and_then(|t| t.as_array())
    .map(|a| a.len() as u32);

  McpConnectionProbeResult {
    ok: true,
    tool_count,
    error_message: None,
    transport: "stdio".to_string(),
  }
}

fn trim_stderr(s: &str) -> String {
  let t = s.trim();
  if t.is_empty() {
    return String::new();
  }
  let max = 600;
  if t.len() <= max {
    t.to_string()
  } else {
    format!("{}…", &t[..max])
  }
}

fn probe_remote(entry: &Map<String, Value>) -> McpConnectionProbeResult {
  let url = entry
    .get("url")
    .and_then(|u| u.as_str())
    .map(str::trim)
    .filter(|s| !s.is_empty());

  let Some(url) = url else {
    return McpConnectionProbeResult {
      ok: false,
      tool_count: None,
      error_message: Some("Missing url.".to_string()),
      transport: "remote".to_string(),
    };
  };

  let mut req = ureq::get(url).timeout(PROBE_DEADLINE);

  if let Some(headers) = entry.get("headers").and_then(|h| h.as_object()) {
    for (k, v) in headers {
      if let Some(val) = v.as_str() {
        req = req.set(k, val);
      }
    }
  }

  match req.call() {
    Ok(resp) => {
      let status = resp.status();
      if (200..500).contains(&status) {
        McpConnectionProbeResult {
          ok: true,
          tool_count: None,
          error_message: None,
          transport: "remote".to_string(),
        }
      } else {
        McpConnectionProbeResult {
          ok: false,
          tool_count: None,
          error_message: Some(format!("HTTP status {status}")),
          transport: "remote".to_string(),
        }
      }
    }
    Err(e) => McpConnectionProbeResult {
      ok: false,
      tool_count: None,
      error_message: Some(e.to_string()),
      transport: "remote".to_string(),
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
    }
  };

  Ok(result)
}
