//! Persistent stdio MCP sessions for the chat agent loop (initialize, tools/list, tools/call).

use std::collections::HashMap;
use std::io::Read;
use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::Instant;

use serde::Serialize;
use serde_json::{json, Map, Value};
use tauri::AppHandle;

use crate::braian_store::workspace_root_path;
use crate::db;
use crate::workspace_mcp_config::load_workspace_mcp_config;
use crate::workspace_mcp_http::RemoteMcpSession;
use crate::workspace_mcp_stdio::{
  mcp_tool_call_finalize_string, read_response_for_id, spawn_stdio_server,
  start_stdout_line_channel, trim_stderr, write_json_line, MCP_RPC_DEADLINE, MCP_STDERR_CAP,
};

const MAX_SERVERS_PER_LIST: usize = 16;
const MAX_TOOLS_PER_SERVER: usize = 64;
const MAX_TOOLS_TOTAL: usize = 128;
const MAX_ARG_JSON_BYTES: usize = 256 * 1024;
type SessionKey = (String, String);

fn sessions_registry() -> &'static Mutex<HashMap<SessionKey, Arc<McpTransport>>> {
  static REG: OnceLock<Mutex<HashMap<SessionKey, Arc<McpTransport>>>> = OnceLock::new();
  REG.get_or_init(|| Mutex::new(HashMap::new()))
}

enum McpTransport {
  Stdio(Arc<StdioMcpSession>),
  Remote(Arc<RemoteMcpSession>),
}

impl McpTransport {
  fn tools_list(&self) -> Result<Vec<Value>, String> {
    match self {
      Self::Stdio(s) => s.tools_list(),
      Self::Remote(r) => r.tools_list(),
    }
  }

  fn tools_call(&self, tool_name: &str, arguments: Value) -> Result<String, String> {
    match self {
      Self::Stdio(s) => s.tools_call(tool_name, arguments),
      Self::Remote(r) => r.tools_call(tool_name, arguments),
    }
  }

  fn shutdown(&self) {
    match self {
      Self::Stdio(s) => s.shutdown(),
      Self::Remote(r) => r.shutdown(),
    }
  }
}

struct WriteState {
  stdin: Option<std::process::ChildStdin>,
  next_id: i64,
  initialized: bool,
}

struct ProcessState {
  child: Option<std::process::Child>,
  stdout_jh: Option<thread::JoinHandle<()>>,
  stderr_jh: Option<thread::JoinHandle<()>>,
}

pub struct StdioMcpSession {
  /// One JSON-RPC flight at a time per MCP process (model may issue parallel tool calls).
  call_serial: Mutex<()>,
  write: Mutex<WriteState>,
  rx: Mutex<std::sync::mpsc::Receiver<String>>,
  process: Mutex<ProcessState>,
  stderr_tail: Arc<Mutex<String>>,
}

impl StdioMcpSession {
  fn spawn_stdio(
    workspace_root: &Path,
    canon_root: &Path,
    entry: &Map<String, Value>,
  ) -> Result<Self, String> {
    let mut child = spawn_stdio_server(workspace_root, canon_root, entry)?;

    let stderr_tail = Arc::new(Mutex::new(String::new()));
    let stderr_tail_clone = Arc::clone(&stderr_tail);
    let stderr_pipe = child.stderr.take();
    let stderr_jh = thread::spawn(move || {
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
      if let Ok(mut g) = stderr_tail_clone.lock() {
        *g = out;
      }
    });

    let stdout = child
      .stdout
      .take()
      .ok_or_else(|| "No stdout from MCP process.".to_string())?;
    let stdin = child
      .stdin
      .take()
      .ok_or_else(|| "No stdin to MCP process.".to_string())?;

    let (rx, stdout_jh) = start_stdout_line_channel(stdout);

    Ok(Self {
      call_serial: Mutex::new(()),
      write: Mutex::new(WriteState {
        stdin: Some(stdin),
        next_id: 1,
        initialized: false,
      }),
      rx: Mutex::new(rx),
      process: Mutex::new(ProcessState {
        child: Some(child),
        stdout_jh: Some(stdout_jh),
        stderr_jh: Some(stderr_jh),
      }),
      stderr_tail,
    })
  }

  fn stderr_hint(&self) -> String {
    let tail = self
      .stderr_tail
      .lock()
      .ok()
      .map(|s| trim_stderr(&s))
      .unwrap_or_default();
    if tail.is_empty() {
      String::new()
    } else {
      format!(" {tail}")
    }
  }

  fn rpc_method(&self, method: &str, params: Value) -> Result<Value, String> {
    let _flight = self
      .call_serial
      .lock()
      .map_err(|_| "MCP session serial lock poisoned.".to_string())?;

    {
      let mut w = self
        .write
        .lock()
        .map_err(|_| "MCP write lock poisoned.".to_string())?;
      if !w.initialized {
        let stdin = w
          .stdin
          .as_mut()
          .ok_or_else(|| "MCP session is closed.".to_string())?;
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
        write_json_line(stdin, &init_req)?;
        drop(w);

        let init_res = {
          let rx = self
            .rx
            .lock()
            .map_err(|_| "MCP rx lock poisoned.".to_string())?;
          read_response_for_id(&*rx, deadline, 1).map_err(|e| {
            format!("{e}{}", self.stderr_hint())
          })?
        };

        if let Some(err) = init_res.get("error") {
          let msg = err
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("initialize failed");
          return Err(format!("{msg}.{}", self.stderr_hint()));
        }

        let mut w = self.write.lock().map_err(|_| "MCP write lock poisoned.".to_string())?;
        let stdin = w
          .stdin
          .as_mut()
          .ok_or_else(|| "MCP session is closed.".to_string())?;
        let notif = json!({
          "jsonrpc": "2.0",
          "method": "notifications/initialized"
        });
        write_json_line(stdin, &notif)?;
        w.initialized = true;
        w.next_id = 2;
      }
    }

    let deadline = Instant::now() + MCP_RPC_DEADLINE;
    let id = {
      let mut w = self
        .write
        .lock()
        .map_err(|_| "MCP write lock poisoned.".to_string())?;
      let id = w.next_id;
      w.next_id += 1;
      let stdin = w
        .stdin
        .as_mut()
        .ok_or_else(|| "MCP session is closed.".to_string())?;
      let req = json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": method,
        "params": params
      });
      write_json_line(stdin, &req)?;
      id
    };

    let rx = self
      .rx
      .lock()
      .map_err(|_| "MCP rx lock poisoned.".to_string())?;
    read_response_for_id(&*rx, deadline, id).map_err(|e| format!("{e}{}", self.stderr_hint()))
  }

  fn tools_list(&self) -> Result<Vec<Value>, String> {
    let v = self.rpc_method("tools/list", json!({}))?;
    if let Some(err) = v.get("error") {
      let msg = err
        .get("message")
        .and_then(|m| m.as_str())
        .unwrap_or("tools/list failed");
      return Err(format!("{msg}.{}", self.stderr_hint()));
    }
    let tools = v
      .get("result")
      .and_then(|r| r.get("tools"))
      .and_then(|t| t.as_array())
      .cloned()
      .unwrap_or_default();
    Ok(tools)
  }

  fn tools_call(&self, tool_name: &str, arguments: Value) -> Result<String, String> {
    let arg_len = serde_json::to_string(&arguments)
      .map(|s| s.len())
      .unwrap_or(0);
    if arg_len > MAX_ARG_JSON_BYTES {
      return Err(format!(
        "Tool arguments exceed limit (>{MAX_ARG_JSON_BYTES} bytes)."
      ));
    }
    let v = self.rpc_method(
      "tools/call",
      json!({
        "name": tool_name,
        "arguments": arguments
      }),
    )?;
    if let Some(err) = v.get("error") {
      let msg = err
        .get("message")
        .and_then(|m| m.as_str())
        .unwrap_or("tools/call failed");
      return Err(format!("{msg}.{}", self.stderr_hint()));
    }
    let result = v
      .get("result")
      .cloned()
      .unwrap_or_else(|| json!({}));
    mcp_tool_call_finalize_string(&result)
  }

  fn shutdown(&self) {
    let _flight = self.call_serial.lock().ok();
    if let Ok(mut w) = self.write.lock() {
      w.stdin.take();
    }
    let Ok(mut p) = self.process.lock() else {
      return;
    };
    if let Some(mut c) = p.child.take() {
      let _ = c.kill();
      let _ = c.wait();
    }
    if let Some(h) = p.stdout_jh.take() {
      let _ = h.join();
    }
    if let Some(h) = p.stderr_jh.take() {
      let _ = h.join();
    }
  }
}

fn is_stdio_server(entry: &Map<String, Value>) -> bool {
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
  url.is_empty() && !command.is_empty()
}

fn is_remote_server(entry: &Map<String, Value>) -> bool {
  let url = entry
    .get("url")
    .and_then(|u| u.as_str())
    .unwrap_or("")
    .trim();
  !url.is_empty()
}

fn disabled_set(cfg: &crate::workspace_mcp_config::WorkspaceMcpConfigDto) -> std::collections::HashSet<String> {
  cfg
    .braian
    .as_ref()
    .map(|b| b.disabled_mcp_servers.iter().cloned().collect())
    .unwrap_or_default()
}

fn get_or_spawn_session(
  app: &AppHandle,
  workspace_id: &str,
  server_name: &str,
  entry: &Map<String, Value>,
) -> Result<Arc<McpTransport>, String> {
  let key = (workspace_id.to_string(), server_name.to_string());
  let mut map = sessions_registry()
    .lock()
    .map_err(|_| "MCP session registry lock poisoned.".to_string())?;
  if let Some(s) = map.get(&key) {
    return Ok(Arc::clone(s));
  }

  let transport = if is_stdio_server(entry) {
    let conn = db::open_connection(app).map_err(|e| e.to_string())?;
    let root = workspace_root_path(&conn, workspace_id)?;
    let canon_root = root.canonicalize().map_err(|e| e.to_string())?;
    McpTransport::Stdio(Arc::new(StdioMcpSession::spawn_stdio(
      &root,
      &canon_root,
      entry,
    )?))
  } else if is_remote_server(entry) {
    McpTransport::Remote(Arc::new(RemoteMcpSession::new(entry)?))
  } else {
    return Err(
      "MCP server entry needs a non-empty \"url\" (remote) or \"command\" (stdio).".to_string(),
    );
  };

  let session = Arc::new(transport);
  map.insert(key, Arc::clone(&session));
  Ok(session)
}

#[derive(Debug, Serialize)]
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpListToolsResultDto {
  pub servers: Vec<McpListToolsServerDto>,
}

#[tauri::command]
pub fn workspace_mcp_list_tools(
  app: AppHandle,
  workspace_id: String,
) -> Result<McpListToolsResultDto, String> {
  let cfg = load_workspace_mcp_config(&app, &workspace_id)?;
  let disabled = disabled_set(&cfg);
  let mut names: Vec<String> = cfg.mcp_servers.keys().cloned().collect();
  names.sort();

  let mut servers_out: Vec<McpListToolsServerDto> = Vec::new();
  let mut total_tools: usize = 0;
  let mut servers_started: usize = 0;

  for name in names {
    if servers_started >= MAX_SERVERS_PER_LIST {
      break;
    }
    if disabled.contains(&name) {
      continue;
    }
    let Some(entry_val) = cfg.mcp_servers.get(&name) else {
      continue;
    };
    let Some(entry) = entry_val.as_object() else {
      continue;
    };
    if !is_stdio_server(entry) && !is_remote_server(entry) {
      continue;
    }

    servers_started += 1;
    let desc = entry
      .get("description")
      .and_then(|v| v.as_str())
      .map(str::trim)
      .filter(|s| !s.is_empty())
      .map(str::to_string);

    match get_or_spawn_session(&app, &workspace_id, &name, entry) {
      Ok(sess) => match sess.tools_list() {
        Ok(mut tools) => {
          if tools.len() > MAX_TOOLS_PER_SERVER {
            tools.truncate(MAX_TOOLS_PER_SERVER);
          }
          let room = MAX_TOOLS_TOTAL.saturating_sub(total_tools);
          if room == 0 {
            servers_out.push(McpListToolsServerDto {
              name,
              description: desc,
              error: Some(format!(
                "Skipped: global tool cap ({MAX_TOOLS_TOTAL}) reached."
              )),
              tools: vec![],
            });
            continue;
          }
          if tools.len() > room {
            tools.truncate(room);
          }
          total_tools += tools.len();
          servers_out.push(McpListToolsServerDto {
            name,
            description: desc,
            error: None,
            tools,
          });
        }
        Err(e) => {
          servers_out.push(McpListToolsServerDto {
            name,
            description: desc,
            error: Some(e),
            tools: vec![],
          });
        }
      },
      Err(e) => {
        servers_out.push(McpListToolsServerDto {
          name,
          description: desc,
          error: Some(e),
          tools: vec![],
        });
      }
    }
  }

  Ok(McpListToolsResultDto {
    servers: servers_out,
  })
}

#[tauri::command]
pub fn workspace_mcp_call_tool(
  app: AppHandle,
  workspace_id: String,
  server_name: String,
  tool_name: String,
  arguments: Value,
) -> Result<String, String> {
  let server = server_name.trim();
  let tool = tool_name.trim();
  if server.is_empty() || tool.is_empty() {
    return Err("serverName and toolName are required.".to_string());
  }

  let cfg = load_workspace_mcp_config(&app, &workspace_id)?;
  if disabled_set(&cfg).contains(server) {
    return Err(format!("MCP server \"{server}\" is disabled."));
  }
  let entry_val = cfg
    .mcp_servers
    .get(server)
    .ok_or_else(|| format!("Unknown MCP server \"{server}\"."))?;
  let entry = entry_val
    .as_object()
    .ok_or_else(|| "Server entry must be a JSON object.".to_string())?;
  if !is_stdio_server(entry) && !is_remote_server(entry) {
    return Err(format!(
      "MCP server \"{server}\" needs a \"url\" (remote) or \"command\" (stdio)."
    ));
  }

  let sess = get_or_spawn_session(&app, &workspace_id, server, entry)?;
  sess.tools_call(tool, arguments)
}

#[tauri::command]
pub fn workspace_mcp_sessions_disconnect(workspace_id: String) -> Result<(), String> {
  let mut map = sessions_registry()
    .lock()
    .map_err(|_| "MCP session registry lock poisoned.".to_string())?;
  let keys: Vec<SessionKey> = map
    .keys()
    .filter(|(ws, _)| ws == &workspace_id)
    .cloned()
    .collect();
  for k in keys {
    if let Some(sess) = map.remove(&k) {
      sess.shutdown();
    }
  }
  Ok(())
}
