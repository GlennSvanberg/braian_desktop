use std::sync::Mutex;

use serde::Serialize;
use serde_json::{json, Map, Value};

use crate::stdio::{mcp_tool_call_finalize_string, MCP_RPC_DEADLINE};

const MAX_PROBE_TOOL_SUMMARIES: usize = 64;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolSummaryDto {
  pub name: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub description: Option<String>,
}

pub struct RemoteMcpSession {
  call_serial: Mutex<()>,
  url: String,
  headers: Vec<(String, String)>,
  session_id: Mutex<Option<String>>,
  next_id: Mutex<i64>,
  initialized: Mutex<bool>,
}

fn entry_url(entry: &Map<String, Value>) -> Result<String, String> {
  let url = entry
    .get("url")
    .and_then(|u| u.as_str())
    .map(str::trim)
    .filter(|s| !s.is_empty())
    .ok_or_else(|| "Missing url.".to_string())?;
  Ok(url.to_string())
}

fn entry_header_pairs(entry: &Map<String, Value>) -> Vec<(String, String)> {
  let Some(h) = entry.get("headers").and_then(|x| x.as_object()) else {
    return Vec::new();
  };
  let mut out: Vec<(String, String)> = Vec::new();
  for (k, v) in h {
    if let Some(s) = v.as_str() {
      out.push((k.clone(), s.to_string()));
    }
  }
  out
}

fn read_session_header(resp: &ureq::Response) -> Option<String> {
  resp.header("mcp-session-id").map(str::to_string)
}

fn mcp_post(
  url: &str,
  headers: &[(String, String)],
  session_id: Option<&str>,
  body: &Value,
) -> Result<(u16, String, Option<String>), String> {
  let body_str = serde_json::to_string(body).map_err(|e| e.to_string())?;
  let mut req = ureq::post(url)
    .timeout(MCP_RPC_DEADLINE)
    .set("Content-Type", "application/json; charset=utf-8")
    .set("Accept", "application/json, text/event-stream");
  for (k, v) in headers {
    req = req.set(k, v);
  }
  if let Some(s) = session_id {
    req = req.set("Mcp-Session-Id", s);
  }
  let resp = req.send_string(&body_str).map_err(|e| e.to_string())?;
  let status = resp.status();
  let new_sid = read_session_header(&resp);
  let text = resp.into_string().map_err(|e| e.to_string())?;
  Ok((status, text, new_sid))
}

fn matches_id(msg: &Value, want_id: i64) -> bool {
  msg.get("id").and_then(|i| i.as_i64()) == Some(want_id)
}

fn parse_json_rpc_message(text: &str, want_id: i64) -> Result<Value, String> {
  let t = text.trim();
  if t.is_empty() {
    return Err("Empty HTTP body from MCP server.".to_string());
  }

  if let Ok(v) = serde_json::from_str::<Value>(t) {
    if matches_id(&v, want_id) {
      return Ok(v);
    }
    if let Some(arr) = v.as_array() {
      for item in arr {
        if matches_id(item, want_id) {
          return Ok(item.clone());
        }
      }
    }
  }

  for line in t.lines() {
    let line = line.trim();
    if line.is_empty() {
      continue;
    }
    if let Some(rest) = line.strip_prefix("data:") {
      let data = rest.trim();
      if data.is_empty() || data == "[DONE]" {
        continue;
      }
      if let Ok(v) = serde_json::from_str::<Value>(data) {
        if matches_id(&v, want_id) {
          return Ok(v);
        }
      }
      continue;
    }
    if let Ok(v) = serde_json::from_str::<Value>(line) {
      if matches_id(&v, want_id) {
        return Ok(v);
      }
    }
  }
  Err(format!(
    "No JSON-RPC response with id {want_id} in MCP HTTP body (len {}).",
    t.len()
  ))
}

fn merge_session_id(current: &Mutex<Option<String>>, incoming: Option<String>) {
  if let Some(s) = incoming {
    if let Ok(mut g) = current.lock() {
      *g = Some(s);
    }
  }
}

impl RemoteMcpSession {
  pub fn new(entry: &Map<String, Value>) -> Result<Self, String> {
    let url = entry_url(entry)?;
    Ok(Self {
      call_serial: Mutex::new(()),
      url,
      headers: entry_header_pairs(entry),
      session_id: Mutex::new(None),
      next_id: Mutex::new(1),
      initialized: Mutex::new(false),
    })
  }

  fn session_id_snapshot(&self) -> Option<String> {
    self.session_id.lock().ok().and_then(|g| g.clone())
  }

  fn post_json_rpc(&self, body: &Value) -> Result<(u16, String), String> {
    let sid = self.session_id_snapshot();
    let sid_ref = sid.as_deref();
    let (status, text, new_sid) = mcp_post(&self.url, &self.headers, sid_ref, body)?;
    merge_session_id(&self.session_id, new_sid);
    Ok((status, text))
  }

  fn ensure_initialized(&self) -> Result<(), String> {
    let init = self
      .initialized
      .lock()
      .map_err(|_| "MCP init lock poisoned.".to_string())?;
    if *init {
      return Ok(());
    }
    drop(init);
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
    let (st, text) = self.post_json_rpc(&init_req)?;
    if !(200..300).contains(&st) {
      return Err(format!(
        "initialize HTTP {st}: {}",
        text.chars().take(400).collect::<String>()
      ));
    }
    let msg = parse_json_rpc_message(&text, 1)?;
    if let Some(err) = msg.get("error") {
      let m = err
        .get("message")
        .and_then(|x| x.as_str())
        .unwrap_or("initialize failed");
      return Err(m.to_string());
    }
    let notif = json!({
      "jsonrpc": "2.0",
      "method": "notifications/initialized"
    });
    let (st2, text2) = self.post_json_rpc(&notif)?;
    if !(200..300).contains(&st2) && st2 != 202 {
      return Err(format!(
        "notifications/initialized HTTP {st2}: {}",
        text2.chars().take(200).collect::<String>()
      ));
    }
    let mut init = self
      .initialized
      .lock()
      .map_err(|_| "MCP init lock poisoned.".to_string())?;
    *init = true;
    let mut nid = self
      .next_id
      .lock()
      .map_err(|_| "MCP next_id lock poisoned.".to_string())?;
    *nid = 2;
    Ok(())
  }

  fn rpc_method(&self, method: &str, params: Value) -> Result<Value, String> {
    let _flight = self
      .call_serial
      .lock()
      .map_err(|_| "MCP HTTP serial lock poisoned.".to_string())?;
    self.ensure_initialized()?;
    let id = {
      let mut nid = self
        .next_id
        .lock()
        .map_err(|_| "MCP next_id lock poisoned.".to_string())?;
      let id = *nid;
      *nid += 1;
      id
    };
    let req = json!({
      "jsonrpc": "2.0",
      "id": id,
      "method": method,
      "params": params
    });
    let (st, text) = self.post_json_rpc(&req)?;
    if !(200..300).contains(&st) {
      return Err(format!(
        "{method} HTTP {st}: {}",
        text.chars().take(400).collect::<String>()
      ));
    }
    if text.trim().is_empty() {
      return Err(format!("Empty body for {method} (HTTP {st})."));
    }
    let msg = parse_json_rpc_message(&text, id)?;
    Ok(msg)
  }

  pub fn tools_list(&self) -> Result<Vec<Value>, String> {
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

  pub fn tools_call(&self, tool_name: &str, arguments: Value) -> Result<String, String> {
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

  pub fn shutdown(&self) {
    let _flight = self.call_serial.lock().ok();
    let sid = self.session_id_snapshot();
    let Some(ref session) = sid else {
      return;
    };
    let mut req = ureq::delete(&self.url)
      .timeout(MCP_RPC_DEADLINE)
      .set("Mcp-Session-Id", session);
    for (k, v) in &self.headers {
      req = req.set(k, v);
    }
    let _ = req.call();
  }
}

pub fn remote_mcp_probe_tool_summaries(
  entry: &Map<String, Value>,
) -> Result<(u32, Vec<McpToolSummaryDto>), String> {
  let session = RemoteMcpSession::new(entry)?;
  session.ensure_initialized()?;
  let tools = session.tools_list()?;
  session.shutdown();
  let mut summaries: Vec<McpToolSummaryDto> = Vec::new();
  for t in tools.iter().take(MAX_PROBE_TOOL_SUMMARIES) {
    let name = t
      .get("name")
      .and_then(|n| n.as_str())
      .unwrap_or("")
      .trim();
    if name.is_empty() {
      continue;
    }
    let description = t
      .get("description")
      .and_then(|d| d.as_str())
      .map(str::trim)
      .filter(|s| !s.is_empty())
      .map(str::to_string);
    summaries.push(McpToolSummaryDto {
      name: name.to_string(),
      description,
    });
  }
  let n = summaries.len() as u32;
  Ok((n, summaries))
}

pub fn map_tools_to_summaries(tools: &[Value]) -> Vec<McpToolSummaryDto> {
  let mut summaries = Vec::new();
  for t in tools.iter().take(MAX_PROBE_TOOL_SUMMARIES) {
    let name = t
      .get("name")
      .and_then(|n| n.as_str())
      .unwrap_or("")
      .trim();
    if name.is_empty() {
      continue;
    }
    let description = t
      .get("description")
      .and_then(|d| d.as_str())
      .map(str::trim)
      .filter(|s| !s.is_empty())
      .map(str::to_string);
    summaries.push(McpToolSummaryDto {
      name: name.to_string(),
      description,
    });
  }
  summaries
}
