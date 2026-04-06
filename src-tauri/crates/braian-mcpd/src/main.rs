use std::collections::HashSet;
use std::io::Read;
use std::path::PathBuf;

use braian_mcp_core::runtime;
use serde::Deserialize;
use serde_json::{json, Value};
use tiny_http::{Method, Response, Server, StatusCode};

#[derive(Deserialize)]
struct ListToolsReq {
  workspace_root_path: String,
  #[serde(default)]
  server_names: Vec<String>,
}

#[derive(Deserialize)]
struct CallToolReq {
  workspace_root_path: String,
  server_name: String,
  tool_name: String,
  arguments: Value,
}

#[derive(Deserialize)]
struct ProbeReq {
  workspace_root_path: String,
  server_name: String,
}

#[derive(Deserialize)]
struct DisconnectReq {
  workspace_root_path: String,
}

fn read_json<T: for<'de> Deserialize<'de>>(req: &mut tiny_http::Request) -> Result<T, String> {
  let mut body = String::new();
  req.as_reader()
    .read_to_string(&mut body)
    .map_err(|e| e.to_string())?;
  serde_json::from_str(&body).map_err(|e| e.to_string())
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
    let path = req.url().to_string();
    if path == "/v1/list-tools" {
      let payload = match read_json::<ListToolsReq>(&mut req) {
        Ok(v) => v,
        Err(e) => {
          respond_json(req, 400, json!({ "error": e }));
          continue;
        }
      };
      let workspace_root = PathBuf::from(payload.workspace_root_path);
      let allow: HashSet<String> = payload
        .server_names
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
      let payload = match read_json::<CallToolReq>(&mut req) {
        Ok(v) => v,
        Err(e) => {
          respond_json(req, 400, json!({ "error": e }));
          continue;
        }
      };
      let workspace_root = PathBuf::from(payload.workspace_root_path);
      match runtime::call_tool(
        &workspace_root,
        &payload.server_name,
        &payload.tool_name,
        payload.arguments,
      ) {
        Ok(text) => respond_json(req, 200, json!({ "text": text })),
        Err(e) => respond_json(req, 500, json!({ "error": e })),
      }
      continue;
    }
    if path == "/v1/probe" {
      let payload = match read_json::<ProbeReq>(&mut req) {
        Ok(v) => v,
        Err(e) => {
          respond_json(req, 400, json!({ "error": e }));
          continue;
        }
      };
      let workspace_root = PathBuf::from(payload.workspace_root_path);
      match runtime::probe_connection(&workspace_root, &payload.server_name) {
        Ok(result) => respond_json(req, 200, serde_json::to_value(result).unwrap_or(json!({}))),
        Err(e) => respond_json(req, 500, json!({ "error": e })),
      }
      continue;
    }
    if path == "/v1/disconnect" {
      let payload = match read_json::<DisconnectReq>(&mut req) {
        Ok(v) => v,
        Err(e) => {
          respond_json(req, 400, json!({ "error": e }));
          continue;
        }
      };
      let workspace_root = PathBuf::from(payload.workspace_root_path);
      match runtime::disconnect_workspace(&workspace_root) {
        Ok(()) => respond_json(req, 200, json!({ "ok": true })),
        Err(e) => respond_json(req, 500, json!({ "error": e })),
      }
      continue;
    }
    respond_json(req, 404, json!({ "error": "not found" }));
  }
}
