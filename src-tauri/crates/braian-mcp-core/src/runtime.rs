use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::Instant;

use serde::Serialize;
use serde_json::{json, Map, Value};

use crate::config::{load_workspace_mcp_config, WorkspaceMcpConfigDto};
use crate::http::{map_tools_to_summaries, remote_mcp_probe_tool_summaries, McpToolSummaryDto, RemoteMcpSession};
use crate::stdio::{
  mcp_tool_call_finalize_string, read_response_for_id, spawn_stdio_server, start_stdout_line_channel,
  trim_stderr, write_json_line, MCP_RPC_DEADLINE, MCP_STDERR_CAP,
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

struct StdioMcpSession {
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
          read_response_for_id(&rx, deadline, 1).map_err(|e| format!("{e}{}", self.stderr_hint()))?
        };
        if let Some(err) = init_res.get("error") {
          let msg = err
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("initialize failed");
          return Err(msg.to_string());
        }
        let mut w2 = self
          .write
          .lock()
          .map_err(|_| "MCP write lock poisoned.".to_string())?;
        let stdin2 = w2
          .stdin
          .as_mut()
          .ok_or_else(|| "MCP session is closed.".to_string())?;
        let notif = json!({
          "jsonrpc": "2.0",
          "method": "notifications/initialized"
        });
        write_json_line(stdin2, &notif)?;
        w2.initialized = true;
        w2.next_id = 2;
      }
    }
    let id = {
      let mut w = self
        .write
        .lock()
        .map_err(|_| "MCP write lock poisoned.".to_string())?;
      let id = w.next_id;
      w.next_id += 1;
      let req = json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": method,
        "params": params
      });
      let stdin = w
        .stdin
        .as_mut()
        .ok_or_else(|| "MCP session is closed.".to_string())?;
      write_json_line(stdin, &req)?;
      id
    };
    let deadline = Instant::now() + MCP_RPC_DEADLINE;
    let rx = self
      .rx
      .lock()
      .map_err(|_| "MCP rx lock poisoned.".to_string())?;
    read_response_for_id(&rx, deadline, id).map_err(|e| format!("{e}{}", self.stderr_hint()))
  }

  fn tools_list(&self) -> Result<Vec<Value>, String> {
    let v = self.rpc_method("tools/list", json!({}))?;
    if let Some(err) = v.get("error") {
      let m = err
        .get("message")
        .and_then(|x| x.as_str())
        .unwrap_or("tools/list failed");
      return Err(m.to_string());
    }
    Ok(v
      .get("result")
      .and_then(|r| r.get("tools"))
      .and_then(|t| t.as_array())
      .cloned()
      .unwrap_or_default())
  }

  fn tools_call(&self, tool_name: &str, arguments: Value) -> Result<String, String> {
    let v = self.rpc_method(
      "tools/call",
      json!({
        "name": tool_name,
        "arguments": arguments
      }),
    )?;
    if let Some(err) = v.get("error") {
      let m = err
        .get("message")
        .and_then(|x| x.as_str())
        .unwrap_or("tools/call failed");
      return Err(m.to_string());
    }
    let result = v.get("result").cloned().unwrap_or_else(|| json!({}));
    mcp_tool_call_finalize_string(&result)
  }

  fn shutdown(&self) {
    if let Ok(mut w) = self.write.lock() {
      w.stdin.take();
    }
    if let Ok(mut p) = self.process.lock() {
      if let Some(mut child) = p.child.take() {
        let _ = child.kill();
        let _ = child.wait();
      }
      if let Some(jh) = p.stdout_jh.take() {
        let _ = jh.join();
      }
      if let Some(jh) = p.stderr_jh.take() {
        let _ = jh.join();
      }
    }
  }
}

#[derive(Debug, Serialize, Clone)]
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

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct McpListToolsResultDto {
  pub servers: Vec<McpListToolsServerDto>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct McpConnectionProbeResult {
  pub ok: bool,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub tool_count: Option<u32>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub error_message: Option<String>,
  pub transport: String,
  #[serde(default)]
  pub tools: Vec<McpToolSummaryDto>,
}

fn is_stdio_server(entry: &Map<String, Value>) -> bool {
  let command = entry
    .get("command")
    .and_then(|c| c.as_str())
    .unwrap_or("")
    .trim();
  let url = entry.get("url").and_then(|u| u.as_str()).unwrap_or("").trim();
  url.is_empty() && !command.is_empty()
}

fn is_remote_server(entry: &Map<String, Value>) -> bool {
  let url = entry.get("url").and_then(|u| u.as_str()).unwrap_or("").trim();
  !url.is_empty()
}

fn disabled_set(cfg: &WorkspaceMcpConfigDto) -> HashSet<String> {
  cfg
    .braian
    .as_ref()
    .map(|b| b.disabled_mcp_servers.iter().cloned().collect())
    .unwrap_or_default()
}

fn get_or_spawn_session(
  workspace_root: &Path,
  server_name: &str,
  entry: &Map<String, Value>,
) -> Result<Arc<McpTransport>, String> {
  let key = (
    workspace_root.to_string_lossy().to_string(),
    server_name.to_string(),
  );
  let mut map = sessions_registry()
    .lock()
    .map_err(|_| "MCP session registry lock poisoned.".to_string())?;
  if let Some(s) = map.get(&key) {
    return Ok(Arc::clone(s));
  }
  let transport = if is_stdio_server(entry) {
    let canon_root = workspace_root.canonicalize().map_err(|e| e.to_string())?;
    McpTransport::Stdio(Arc::new(StdioMcpSession::spawn_stdio(
      workspace_root,
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

pub fn list_tools(
  workspace_root: &Path,
  allow_servers: Option<&HashSet<String>>,
) -> Result<McpListToolsResultDto, String> {
  let cfg = load_workspace_mcp_config(workspace_root)?;
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
    if let Some(allow) = allow_servers {
      if !allow.contains(&name) {
        continue;
      }
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
    match get_or_spawn_session(workspace_root, &name, entry) {
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
              error: Some(format!("Skipped: global tool cap ({MAX_TOOLS_TOTAL}) reached.")),
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
  Ok(McpListToolsResultDto { servers: servers_out })
}

pub fn call_tool(
  workspace_root: &Path,
  server_name: &str,
  tool_name: &str,
  arguments: Value,
) -> Result<String, String> {
  if server_name.trim().is_empty() || tool_name.trim().is_empty() {
    return Err("serverName and toolName are required.".to_string());
  }
  let cfg = load_workspace_mcp_config(workspace_root)?;
  if disabled_set(&cfg).contains(server_name) {
    return Err(format!("MCP server \"{server_name}\" is disabled."));
  }
  let entry_val = cfg
    .mcp_servers
    .get(server_name)
    .ok_or_else(|| format!("Unknown MCP server \"{server_name}\"."))?;
  let entry = entry_val
    .as_object()
    .ok_or_else(|| "Server entry must be a JSON object.".to_string())?;
  let arg_len = serde_json::to_vec(&arguments)
    .map_err(|e| e.to_string())?
    .len();
  if arg_len > MAX_ARG_JSON_BYTES {
    return Err("arguments JSON too large.".to_string());
  }
  let sess = get_or_spawn_session(workspace_root, server_name, entry)?;
  sess.tools_call(tool_name, arguments)
}

pub fn probe_connection(workspace_root: &Path, name: &str) -> Result<McpConnectionProbeResult, String> {
  let cfg = load_workspace_mcp_config(workspace_root)?;
  let entry_val = cfg
    .mcp_servers
    .get(name)
    .ok_or_else(|| format!("Unknown server \"{name}\"."))?;
  let entry = entry_val
    .as_object()
    .ok_or_else(|| "Server entry must be a JSON object.".to_string())?;
  let url = entry.get("url").and_then(|u| u.as_str()).unwrap_or("").trim();
  let command = entry
    .get("command")
    .and_then(|c| c.as_str())
    .unwrap_or("")
    .trim();
  if !url.is_empty() {
    return Ok(match remote_mcp_probe_tool_summaries(entry) {
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
    });
  }
  if !command.is_empty() {
    return Ok(match get_or_spawn_session(workspace_root, name, entry) {
      Ok(sess) => match sess.tools_list() {
        Ok(tools) => {
          let summaries = map_tools_to_summaries(&tools);
          McpConnectionProbeResult {
            ok: true,
            tool_count: Some(summaries.len() as u32),
            error_message: None,
            transport: "stdio".to_string(),
            tools: summaries,
          }
        }
        Err(e) => McpConnectionProbeResult {
          ok: false,
          tool_count: None,
          error_message: Some(e),
          transport: "stdio".to_string(),
          tools: vec![],
        },
      },
      Err(e) => McpConnectionProbeResult {
        ok: false,
        tool_count: None,
        error_message: Some(e),
        transport: "stdio".to_string(),
        tools: vec![],
      },
    });
  }
  Ok(McpConnectionProbeResult {
    ok: false,
    tool_count: None,
    error_message: Some("Need command (stdio) or url (remote).".to_string()),
    transport: "unknown".to_string(),
    tools: vec![],
  })
}

pub fn disconnect_workspace(workspace_root: &Path) -> Result<(), String> {
  let mut map = sessions_registry()
    .lock()
    .map_err(|_| "MCP session registry lock poisoned.".to_string())?;
  let ws = workspace_root.to_string_lossy().to_string();
  let keys: Vec<SessionKey> = map
    .keys()
    .filter(|(root, _)| root == &ws)
    .cloned()
    .collect();
  for k in keys {
    if let Some(sess) = map.remove(&k) {
      sess.shutdown();
    }
  }
  Ok(())
}
