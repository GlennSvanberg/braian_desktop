use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use sha2::{Digest, Sha256};
use tiny_http::{Header, Method, Response, Server, StatusCode};
use tauri::{AppHandle, State};

use crate::braian_store::workspace_root_path;
use crate::db;
use crate::workspace;
use crate::workspace_files::safe_join_workspace;
use crate::workspace_webapp_dev::webapp_dir_for;

const FINGERPRINT_MAX_FILES: usize = 10_000;
const BUILD_OUTPUT_CAP: usize = 256 * 1024;

pub struct WebappStaticServerState {
  port: Mutex<u16>,
}

impl WebappStaticServerState {
  pub fn start(app_handle: AppHandle) -> Self {
    let (tx, rx) = std::sync::mpsc::channel::<u16>();
    let ah = app_handle.clone();
    std::thread::spawn(move || {
      let server = match Server::http("127.0.0.1:0") {
        Ok(s) => s,
        Err(e) => {
          log::error!("workspace webapp static server: bind failed: {e}");
          let _ = tx.send(0u16);
          return;
        }
      };
      let port = server
        .server_addr()
        .to_ip()
        .map(|a| a.port())
        .unwrap_or(0u16);
      if tx.send(port).is_err() {
        return;
      }
      for request in server.incoming_requests() {
        if let Err(e) = handle_static_request(&ah, request) {
          log::warn!("workspace webapp static: {e}");
        }
      }
    });
    let port = rx.recv().unwrap_or(0u16);
    if port == 0 {
      log::error!("workspace webapp static server: failed to obtain port");
    } else {
      log::info!("workspace webapp static server listening on 127.0.0.1:{port}");
    }
    Self {
      port: Mutex::new(port),
    }
  }

  fn origin(&self) -> Result<String, String> {
    let p = *self.port.lock().map_err(|e| e.to_string())?;
    if p == 0 {
      return Err("Static file server is not available.".to_string());
    }
    Ok(format!("http://127.0.0.1:{p}"))
  }
}

fn now_ms() -> i64 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|d| d.as_millis() as i64)
    .unwrap_or(0)
}

fn skip_fingerprint_dir(name: &str) -> bool {
  matches!(
    name,
    "node_modules" | "dist" | ".git" | ".vite" | "coverage"
  )
}

/// Fingerprint of `.braian/webapp` sources (excluding heavy/derived dirs) for dirty detection.
pub fn fingerprint_webapp_sources(webapp_dir: &Path) -> Result<String, String> {
  let mut entries: Vec<(String, u64, u64)> = Vec::new();
  walk_for_fingerprint(webapp_dir, webapp_dir, &mut entries, 0)?;
  entries.sort_by(|a, b| a.0.cmp(&b.0));
  let mut hasher = Sha256::new();
  for (rel, size, mtime_secs) in entries {
    hasher.update(rel.as_bytes());
    hasher.update(&[0]);
    hasher.update(size.to_le_bytes());
    hasher.update(mtime_secs.to_le_bytes());
  }
  Ok(hex::encode(hasher.finalize()))
}

fn walk_for_fingerprint(
  root: &Path,
  current: &Path,
  out: &mut Vec<(String, u64, u64)>,
  depth: u32,
) -> Result<(), String> {
  if depth > 64 {
    return Err("Webapp tree too deep.".to_string());
  }
  if out.len() >= FINGERPRINT_MAX_FILES {
    return Err(format!(
      "Webapp tree has too many files (>{FINGERPRINT_MAX_FILES})."
    ));
  }
  let read_dir = fs::read_dir(current).map_err(|e| e.to_string())?;
  for ent in read_dir {
    let ent = ent.map_err(|e| e.to_string())?;
    let name = ent.file_name().to_string_lossy().to_string();
    if skip_fingerprint_dir(&name) {
      continue;
    }
    let path = ent.path();
    let rel = path
      .strip_prefix(root)
      .map_err(|_| "Path strip failed.".to_string())?
      .to_string_lossy()
      .replace('\\', "/");
    let meta = ent.metadata().map_err(|e| e.to_string())?;
    if meta.is_dir() {
      walk_for_fingerprint(root, &path, out, depth + 1)?;
    } else if meta.is_file() {
      let size = meta.len();
      let mtime_secs = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
      out.push((rel, size, mtime_secs));
    }
  }
  Ok(())
}

fn is_probably_asset_path(rel: &Path) -> bool {
  match rel.extension().and_then(|e| e.to_str()) {
    None => false,
    Some(ext) => {
      let e = ext.to_ascii_lowercase();
      matches!(
        e.as_str(),
        "js" | "mjs"
          | "cjs"
          | "css"
          | "map"
          | "json"
          | "png"
          | "jpg"
          | "jpeg"
          | "gif"
          | "svg"
          | "webp"
          | "ico"
          | "woff"
          | "woff2"
          | "ttf"
          | "eot"
          | "wasm"
          | "txt"
          | "html"
          | "webmanifest"
          | "xml"
          | "mp3"
          | "mp4"
          | "webm"
          | "pdf"
      )
    }
  }
}

fn respond_bytes(
  request: tiny_http::Request,
  status: StatusCode,
  content_type: &str,
  body: Vec<u8>,
) -> Result<(), String> {
  let h = Header::from_bytes(&b"Content-Type"[..], content_type.as_bytes()).map_err(|_| {
    "Invalid Content-Type header.".to_string()
  })?;
  let r = Response::from_data(body)
    .with_status_code(status)
    .with_header(h);
  request.respond(r).map_err(|e| e.to_string())
}

fn serve_file(request: tiny_http::Request, path: &Path) -> Result<(), String> {
  let file = File::open(path).map_err(|e| e.to_string())?;
  let mime = mime_guess::from_path(path)
    .first_raw()
    .unwrap_or("application/octet-stream");
  let h = Header::from_bytes(&b"Content-Type"[..], mime.as_bytes()).map_err(|_| {
    "Invalid Content-Type header.".to_string()
  })?;
  let mut r = Response::from_file(file);
  r.add_header(h);
  request.respond(r).map_err(|e| e.to_string())
}

fn serve_index_html(request: tiny_http::Request, index_path: &Path) -> Result<(), String> {
  serve_file(request, index_path)
}

fn handle_static_request(app: &AppHandle, request: tiny_http::Request) -> Result<(), String> {
  if *request.method() != Method::Get {
    let h = Header::from_bytes(&b"Allow"[..], &b"GET"[..])
      .map_err(|_| "Invalid Allow header.".to_string())?;
    let mut r = Response::empty(StatusCode(405));
    r.add_header(h);
    request.respond(r).map_err(|e| e.to_string())?;
    return Ok(());
  }

  let raw_url = request.url().to_string();
  let path_only = raw_url
    .split(|c| c == '?' || c == '#')
    .next()
    .unwrap_or("")
    .to_string();

  let segments: Vec<&str> = path_only
    .split('/')
    .filter(|s| !s.is_empty())
    .collect();

  if segments.len() < 2 || segments[0] != "w" {
    respond_bytes(
      request,
      StatusCode(404),
      "text/plain",
      b"Not found".to_vec(),
    )?;
    return Ok(());
  }

  let workspace_id = segments[1].to_string();
  for seg in segments.iter().skip(2) {
    if *seg == ".." {
      respond_bytes(
        request,
        StatusCode(400),
        "text/plain",
        b"Bad path".to_vec(),
      )?;
      return Ok(());
    }
  }

  let conn = db::open_connection(app).map_err(|e| e.to_string())?;
  let root = workspace_root_path(&conn, &workspace_id).map_err(|_| "Workspace not found.".to_string())?;
  let webapp_dir = safe_join_workspace(&root, crate::workspace_webapp_dev::WEBAPP_RELATIVE_DIR)?;
  let dist_dir = webapp_dir.join("dist");
  let dist_base = match dist_dir.canonicalize() {
    Ok(p) => p,
    Err(_) => {
      respond_bytes(
        request,
        StatusCode(404),
        "text/plain",
        b"Not published".to_vec(),
      )?;
      return Ok(());
    }
  };

  let index_path = dist_base.join("index.html");
  if !index_path.is_file() {
    respond_bytes(
      request,
      StatusCode(404),
      "text/plain",
      b"Not published".to_vec(),
    )?;
    return Ok(());
  }

  let sub_segments = segments.iter().skip(2).copied().collect::<Vec<_>>();
  let mut rel = PathBuf::new();
  for seg in &sub_segments {
    rel.push(seg);
  }

  let candidate = dist_base.join(&rel);
  if !candidate.starts_with(&dist_base) {
    respond_bytes(
      request,
      StatusCode(404),
      "text/plain",
      b"Not found".to_vec(),
    )?;
    return Ok(());
  }

  if candidate.is_file() {
    return serve_file(request, &candidate);
  }

  let as_index = candidate.join("index.html");
  if as_index.is_file() {
    return serve_file(request, &as_index);
  }

  if sub_segments.is_empty() || !is_probably_asset_path(&rel) {
    return serve_index_html(request, &index_path);
  }

  respond_bytes(
    request,
    StatusCode(404),
    "text/plain",
    b"Not found".to_vec(),
  )
}

fn vite_base_path(workspace_id: &str) -> String {
  format!("/w/{workspace_id}/")
}

fn run_npm_build_with_base(webapp_dir: &Path, base: &str) -> Result<String, String> {
  #[cfg(windows)]
  {
    let mut cmd = Command::new("cmd.exe");
    cmd.args([
      "/C",
      "npm",
      "run",
      "build",
      "--",
      "--base",
      base,
    ]);
    cmd.current_dir(webapp_dir);
    cmd.stdin(std::process::Stdio::null());
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
    let out = cmd.output().map_err(|e| {
      format!("Failed to run npm build (is Node.js installed and on PATH?): {e}")
    })?;
    return format_build_result(out);
  }

  #[cfg(unix)]
  {
    let mut cmd = Command::new("sh");
    cmd
      .arg("-c")
      .arg(format!("npm run build -- --base {}", base));
    cmd.current_dir(webapp_dir);
    cmd.stdin(std::process::Stdio::null());
    use std::os::unix::process::CommandExt;
    unsafe {
      cmd.pre_exec(|| {
        libc::setsid();
        Ok(())
      });
    }
    let out = cmd.output().map_err(|e| {
      format!("Failed to run npm build (is Node.js installed and on PATH?): {e}")
    })?;
    return format_build_result(out);
  }

  #[cfg(not(any(windows, unix)))]
  {
    Err("Unsupported platform for workspace webapp publish.".to_string())
  }
}

fn format_build_result(out: std::process::Output) -> Result<String, String> {
  let mut combined = Vec::new();
  combined.extend_from_slice(b"--- stdout ---\n");
  combined.extend_from_slice(&out.stdout);
  combined.extend_from_slice(b"\n--- stderr ---\n");
  combined.extend_from_slice(&out.stderr);
  if combined.len() > BUILD_OUTPUT_CAP {
    let start = combined.len() - BUILD_OUTPUT_CAP;
    combined = combined[start..].to_vec();
    combined.splice(0..0, b"...(truncated)\n".to_vec());
  }
  let text = String::from_utf8_lossy(&combined).into_owned();
  if out.status.success() {
    Ok(text)
  } else {
    Err(text)
  }
}

pub fn published_preview_url(origin: &str, workspace_id: &str, preview_path: &str) -> String {
  let base = format!("{origin}/w/{workspace_id}");
  if preview_path == "/" {
    format!("{base}/")
  } else {
    format!("{base}{preview_path}")
  }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebappPublishResult {
  pub ok: bool,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub log_summary: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebappPublishStatus {
  pub static_server_origin: String,
  pub has_published_dist: bool,
  pub published_at_ms: i64,
  pub has_unpublished_changes: bool,
  pub preview_path: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub published_preview_url: Option<String>,
}

#[tauri::command]
pub fn webapp_static_server_url(state: State<'_, WebappStaticServerState>) -> Result<String, String> {
  state.origin()
}

#[tauri::command]
pub fn webapp_publish(
  app: AppHandle,
  static_state: State<'_, WebappStaticServerState>,
  workspace_id: String,
) -> Result<WebappPublishResult, String> {
  let _ = static_state.origin()?;

  let webapp_dir = webapp_dir_for(&app, &workspace_id)?;
  let pkg = webapp_dir.join("package.json");
  if !pkg.is_file() {
    return Err(format!(
      "No workspace webapp at {}. Initialize from the Webapp screen first.",
      crate::workspace_webapp_dev::WEBAPP_RELATIVE_DIR
    ));
  }

  let base = vite_base_path(&workspace_id);
  match run_npm_build_with_base(&webapp_dir, &base) {
    Ok(log_summary) => {
      let dist_index = webapp_dir.join("dist/index.html");
      if !dist_index.is_file() {
        return Ok(WebappPublishResult {
          ok: false,
          log_summary: Some(
            "Build reported success but dist/index.html is missing.".to_string(),
          ),
        });
      }
      let fp = fingerprint_webapp_sources(&webapp_dir)?;
      let at = now_ms();
      workspace::webapp_publish_metadata_set(&app, &workspace_id, at, &fp)?;
      let workspace_root = webapp_dir
        .parent()
        .and_then(|p| p.parent())
        .ok_or_else(|| "Invalid webapp directory layout.".to_string())?;
      if let Err(e) = crate::workspace_hub::write_webapp_apps_manifest(workspace_root) {
        log::warn!("webapp apps manifest after publish: {e}");
      }
      Ok(WebappPublishResult {
        ok: true,
        log_summary: Some(log_summary),
      })
    }
    Err(log_summary) => Ok(WebappPublishResult {
      ok: false,
      log_summary: Some(log_summary),
    }),
  }
}

fn publish_status_inner(
  app: &AppHandle,
  static_state: &WebappStaticServerState,
  workspace_id: &str,
) -> Result<WebappPublishStatus, String> {
  let static_server_origin = static_state.origin()?;
  let webapp_dir = webapp_dir_for(app, workspace_id)?;
  let pkg_ok = webapp_dir.join("package.json").is_file();
  let has_published_dist = webapp_dir.join("dist/index.html").is_file();
  let published_at_ms = workspace::webapp_published_at_ms_get(app, workspace_id)?;
  let stored_fp = workspace::webapp_publish_fingerprint_get(app, workspace_id)?;
  let preview_path = workspace::webapp_preview_path_get(app, workspace_id)?;

  let current_fp = if pkg_ok {
    fingerprint_webapp_sources(&webapp_dir).unwrap_or_else(|e| {
      log::warn!("webapp fingerprint recompute failed: {e}");
      String::new()
    })
  } else {
    String::new()
  };

  let has_unpublished_changes = if !pkg_ok {
    false
  } else if published_at_ms == 0 {
    true
  } else if stored_fp.is_empty() {
    true
  } else if current_fp.is_empty() {
    false
  } else {
    stored_fp != current_fp
  };

  let published_preview_url = if has_published_dist {
    Some(published_preview_url(
      &static_server_origin,
      workspace_id,
      &preview_path,
    ))
  } else {
    None
  };

  Ok(WebappPublishStatus {
    static_server_origin,
    has_published_dist,
    published_at_ms,
    has_unpublished_changes,
    preview_path,
    published_preview_url,
  })
}

#[tauri::command]
pub fn webapp_publish_status(
  app: AppHandle,
  static_state: State<'_, WebappStaticServerState>,
  workspace_id: String,
) -> Result<WebappPublishStatus, String> {
  publish_status_inner(&app, &static_state, &workspace_id)
}
