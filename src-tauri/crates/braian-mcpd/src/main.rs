use std::collections::HashSet;
use std::path::PathBuf;

use braian_mcp_core::runtime;
use braian_mcpd::normalize_http_route_path;
use serde_json::{json, Map, Value};
use tiny_http::{Method, Response, Server, StatusCode};

fn read_body(req: &mut tiny_http::Request) -> Result<String, String> {
  let mut body = String::new();
  req
    .as_reader()
    .read_to_string(&mut body)
    .map_err(|e| e.to_string())?;
  Ok(body)
}

fn parse_object(body: &str) -> Result<Map<String, Value>, String> {
  let v: Value = serde_json::from_str(body).map_err(|e| e.to_string())?;
  v.as_object()
    .cloned()
    .ok_or_else(|| "JSON body must be an object".to_string())
}

fn str_field(obj: &Map<String, Value>, camel: &str, snake: &str) -> Result<String, String> {
  let v = obj
    .get(camel)
    .or_else(|| obj.get(snake))
    .ok_or_else(|| format!("missing string field `{camel}` or `{snake}`"))?;
  v.as_str()
    .map(str::to_string)
    .ok_or_else(|| format!("`{camel}` / `{snake}` must be a JSON string"))
}

fn string_array_field(obj: &Map<String, Value>, camel: &str, snake: &str) -> Vec<String> {
  obj
    .get(camel)
    .or_else(|| obj.get(snake))
    .and_then(|v| v.as_array())
    .map(|a| {
      a.iter()
        .filter_map(|x| x.as_str().map(str::trim).filter(|s| !s.is_empty()).map(String::from))
        .collect()
    })
    .unwrap_or_default()
}

fn respond_json(req: tiny_http::Request, status: u16, value: Value) {
  let body = serde_json::to_string(&value).unwrap_or_else(|_| "{\"ok\":false}".to_string());
  let resp = Response::from_string(body)
    .with_status_code(StatusCode(status))
    .with_header(
      tiny_http::Header::from_bytes(
        b"Content-Type".to_vec(),
        b"application/json; charset=utf-8".to_vec(),
      )
      .expect("content-type header"),
    );
  let _ = req.respond(resp);
}

fn main() {
  // Stdio MCP spawn diagnostics (PATH, resolved npx.cmd, etc.): set
  // `RUST_LOG=braian_mcp_stdio=debug` (or `RUST_LOG=debug`) before starting Braian / mcpd.
  let _ = env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("warn"))
    .format_timestamp_millis()
    .try_init();

  let mut port: Option<u16> = None;
  let mut token: Option<String> = None;
  let mut args = std::env::args().skip(1);
  while let Some(a) = args.next() {
    if a == "--port" {
      port = args.next().and_then(|x| x.parse::<u16>().ok());
      continue;
    }
    if a == "--token" {
      token = args.next();
      continue;
    }
  }
  let Some(port) = port else {
    eprintln!("Missing --port");
    std::process::exit(2);
  };
  let Some(token) = token else {
    eprintln!("Missing --token");
    std::process::exit(2);
  };
  eprintln!("braian-mcpd listening on 127.0.0.1:{port} (request wire: camelCase + snake_case keys)");
  let server = Server::http(("127.0.0.1", port)).expect("start mcpd");
  for mut req in server.incoming_requests() {
    if req.method() != &Method::Post {
      respond_json(req, 405, json!({ "error": "POST required" }));
      continue;
    }
    let auth = req
      .headers()
      .iter()
      .find(|h| h.field.equiv("x-braian-mcpd-token"))
      .map(|h| h.value.as_str().to_string())
      .unwrap_or_default();
    if auth != token {
      respond_json(req, 401, json!({ "error": "unauthorized" }));
      continue;
    }
    // tiny_http exposes the raw request URI: usually `/v1/probe`, but some clients send an
    // absolute URI (`http://127.0.0.1:PORT/v1/probe`). Match on the `/v1/...` suffix.
    let raw_path = req.url().to_string();
    let path = normalize_http_route_path(&raw_path);
    println!("mcpd: {} {}", req.method(), path);
    if path == "/v1/list-tools" {
      let body = match read_body(&mut req) {
        Ok(b) => b,
        Err(e) => {
          respond_json(req, 400, json!({ "error": e }));
          continue;
        }
      };
      let obj = match parse_object(&body) {
        Ok(o) => o,
        Err(e) => {
          respond_json(req, 400, json!({ "error": e }));
          continue;
        }
      };
      let workspace_root_path = match str_field(&obj, "workspaceRootPath", "workspace_root_path") {
        Ok(s) => s,
        Err(e) => {
          respond_json(req, 400, json!({ "error": e }));
          continue;
        }
      };
      let server_names = string_array_field(&obj, "serverNames", "server_names");
      let workspace_root = PathBuf::from(workspace_root_path);
      let allow: HashSet<String> = server_names
        .iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
      let allow_ref = if allow.is_empty() { None } else { Some(&allow) };
      match runtime::list_tools(&workspace_root, allow_ref) {
        Ok(result) => respond_json(req, 200, serde_json::to_value(result).unwrap_or(json!({}))),
        Err(e) => respond_json(req, 500, json!({ "error": e })),
      }
      continue;
    }
    if path == "/v1/call-tool" {
      let body = match read_body(&mut req) {
        Ok(b) => b,
        Err(e) => {
          respond_json(req, 400, json!({ "error": e }));
          continue;
        }
      };
      let obj = match parse_object(&body) {
        Ok(o) => o,
        Err(e) => {
          respond_json(req, 400, json!({ "error": e }));
          continue;
        }
      };
      let workspace_root_path = match str_field(&obj, "workspaceRootPath", "workspace_root_path") {
        Ok(s) => s,
        Err(e) => {
          respond_json(req, 400, json!({ "error": e }));
          continue;
        }
      };
      let server_name = match str_field(&obj, "serverName", "server_name") {
        Ok(s) => s,
        Err(e) => {
          respond_json(req, 400, json!({ "error": e }));
          continue;
        }
      };
      let tool_name = match str_field(&obj, "toolName", "tool_name") {
        Ok(s) => s,
        Err(e) => {
          respond_json(req, 400, json!({ "error": e }));
          continue;
        }
      };
      let arguments = obj.get("arguments").cloned().unwrap_or(Value::Null);
      let workspace_root = PathBuf::from(workspace_root_path);
      match runtime::call_tool(&workspace_root, &server_name, &tool_name, arguments) {
        Ok(text) => respond_json(req, 200, json!({ "text": text })),
        Err(e) => respond_json(req, 500, json!({ "error": e })),
      }
      continue;
    }
    if path == "/v1/probe" {
      let body = match read_body(&mut req) {
        Ok(b) => b,
        Err(e) => {
          respond_json(req, 400, json!({ "error": e }));
          continue;
        }
      };
      let obj = match parse_object(&body) {
        Ok(o) => o,
        Err(e) => {
          respond_json(req, 400, json!({ "error": e }));
          continue;
        }
      };
      let workspace_root_path = match str_field(&obj, "workspaceRootPath", "workspace_root_path") {
        Ok(s) => s,
        Err(e) => {
          respond_json(req, 400, json!({ "error": e }));
          continue;
        }
      };
      let server_name = match str_field(&obj, "serverName", "server_name") {
        Ok(s) => s,
        Err(e) => {
          respond_json(req, 400, json!({ "error": e }));
          continue;
        }
      };
      let workspace_root = PathBuf::from(workspace_root_path);
      match runtime::probe_connection(&workspace_root, &server_name) {
        Ok(result) => respond_json(req, 200, serde_json::to_value(result).unwrap_or(json!({}))),
        Err(e) => respond_json(req, 500, json!({ "error": e })),
      }
      continue;
    }
    if path == "/v1/disconnect" {
      let body = match read_body(&mut req) {
        Ok(b) => b,
        Err(e) => {
          respond_json(req, 400, json!({ "error": e }));
          continue;
        }
      };
      let obj = match parse_object(&body) {
        Ok(o) => o,
        Err(e) => {
          respond_json(req, 400, json!({ "error": e }));
          continue;
        }
      };
      let workspace_root_path = match str_field(&obj, "workspaceRootPath", "workspace_root_path") {
        Ok(s) => s,
        Err(e) => {
          respond_json(req, 400, json!({ "error": e }));
          continue;
        }
      };
      let workspace_root = PathBuf::from(workspace_root_path);
      match runtime::disconnect_workspace(&workspace_root) {
        Ok(()) => respond_json(req, 200, json!({ "ok": true })),
        Err(e) => respond_json(req, 500, json!({ "error": e })),
      }
      continue;
    }
    respond_json(req, 404, json!({ "error": "not found" }));
  }
}
