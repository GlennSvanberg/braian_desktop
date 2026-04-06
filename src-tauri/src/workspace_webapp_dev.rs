use std::collections::HashMap;
use std::fs;
use std::io::{BufReader, Read};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager, State};

use crate::braian_store::workspace_root_path;
use crate::db;
use crate::workspace;
use crate::workspace_files::safe_join_workspace;

/// Workspace-relative root for the Vite user app (Layer C).
pub const WEBAPP_RELATIVE_DIR: &str = ".braian/webapp";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebappDevStartResult {
  pub port: u16,
  pub url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebappDevStatus {
  pub running: bool,
  /// True when `.braian/webapp/package.json` exists.
  pub has_package_json: bool,
  /// True when `.braian/webapp/node_modules` exists as a directory.
  pub has_node_modules: bool,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub port: Option<u16>,
  /// Base dev server URL (`http://127.0.0.1:<port>/`).
  #[serde(skip_serializing_if = "Option::is_none")]
  pub url: Option<String>,
  /// Stored iframe path suffix (e.g. `/calculator`).
  #[serde(skip_serializing_if = "Option::is_none")]
  pub preview_path: Option<String>,
  /// Full URL loaded in the preview iframe when the dev server is running.
  #[serde(skip_serializing_if = "Option::is_none")]
  pub preview_url: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub last_error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebappInitResult {
  pub copied_files: usize,
  pub skipped_existing: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebappDevLogsResult {
  pub text: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebappPreviewPathSetResult {
  pub preview_path: String,
}

const DEV_LOG_CAP_BYTES: usize = 256 * 1024;

struct RunningDev {
  child: Child,
  port: u16,
}

pub struct WebappDevState {
  inner: Mutex<HashMap<String, RunningDev>>,
  last_error: Mutex<HashMap<String, String>>,
  dev_logs: Arc<Mutex<HashMap<String, Vec<u8>>>>,
}

impl Default for WebappDevState {
  fn default() -> Self {
    Self {
      inner: Mutex::new(HashMap::new()),
      last_error: Mutex::new(HashMap::new()),
      dev_logs: Arc::new(Mutex::new(HashMap::new())),
    }
  }
}

fn clear_dev_log_buffer(logs: &Arc<Mutex<HashMap<String, Vec<u8>>>>, workspace_id: &str) {
  if let Ok(mut m) = logs.lock() {
    m.remove(workspace_id);
  }
}

fn append_dev_log_chunk(
  logs: &Arc<Mutex<HashMap<String, Vec<u8>>>>,
  workspace_id: &str,
  prefix: &[u8],
  chunk: &[u8],
) {
  if let Ok(mut m) = logs.lock() {
    let v = m.entry(workspace_id.to_string()).or_default();
    v.extend_from_slice(prefix);
    v.extend_from_slice(chunk);
    if v.len() > DEV_LOG_CAP_BYTES {
      let overflow = v.len() - DEV_LOG_CAP_BYTES;
      v.drain(..overflow);
    }
  }
}

fn spawn_dev_stream_reader<R: Read + Send + 'static>(
  logs: Arc<Mutex<HashMap<String, Vec<u8>>>>,
  workspace_id: String,
  label: &'static str,
  stream: Option<R>,
) {
  let Some(read) = stream else {
    return;
  };
  thread::spawn(move || {
    let prefix = format!("[{label}] ").into_bytes();
    let mut reader = BufReader::new(read);
    let mut buf = [0u8; 4096];
    loop {
      match reader.read(&mut buf) {
        Ok(0) => break,
        Ok(n) => append_dev_log_chunk(&logs, &workspace_id, &prefix, &buf[..n]),
        Err(_) => break,
      }
    }
  });
}

fn set_last_error(state: &WebappDevState, workspace_id: &str, msg: String) {
  if let Ok(mut m) = state.last_error.lock() {
    m.insert(workspace_id.to_string(), msg);
  }
}

fn clear_last_error(state: &WebappDevState, workspace_id: &str) {
  if let Ok(mut m) = state.last_error.lock() {
    m.remove(workspace_id);
  }
}

pub(crate) fn webapp_dir_for(app: &AppHandle, workspace_id: &str) -> Result<PathBuf, String> {
  let conn = db::open_connection(app).map_err(|e| e.to_string())?;
  let root = workspace_root_path(&conn, workspace_id)?;
  safe_join_workspace(&root, WEBAPP_RELATIVE_DIR)
}

fn strip_query_fragment(s: &str) -> &str {
  s.split(|c| c == '?' || c == '#')
    .next()
    .unwrap_or(s)
}

/// Normalize user/AI input into a safe path starting with `/`.
pub fn normalize_webapp_preview_path(raw: &str) -> Result<String, String> {
  let t = raw.trim();
  let head = strip_query_fragment(t);
  if head.is_empty() {
    return Ok("/".to_string());
  }
  if !head.starts_with('/') {
    return Err("Path must start with /.".to_string());
  }
  for seg in head.split('/') {
    if seg == ".." {
      return Err("Path must not contain \"..\"".to_string());
    }
  }
  let mut s = head.to_string();
  while s.len() > 1 && s.ends_with('/') {
    s.pop();
  }
  if s.is_empty() {
    s = "/".to_string();
  }
  Ok(s)
}

fn preview_url_for_port(port: u16, path: &str) -> String {
  let base = format!("http://127.0.0.1:{port}");
  if path == "/" {
    format!("{base}/")
  } else {
    format!("{base}{path}")
  }
}

fn pick_free_port() -> Result<u16, String> {
  let listener =
    TcpListener::bind("127.0.0.1:0").map_err(|e| format!("Failed to bind ephemeral port: {e}"))?;
  let port = listener
    .local_addr()
    .map_err(|e| format!("Failed to read local addr: {e}"))?
    .port();
  drop(listener);
  Ok(port)
}

/// Probe until Vite responds or timeout (best-effort).
fn wait_for_http_ready(url: &str, timeout: Duration) -> bool {
  let deadline = Instant::now() + timeout;
  while Instant::now() < deadline {
    match ureq::get(url)
      .timeout(Duration::from_millis(400))
      .call()
    {
      Ok(resp) => {
        let status = resp.status();
        if (200..500).contains(&status) {
          return true;
        }
      }
      Err(_) => {}
    }
    thread::sleep(Duration::from_millis(120));
  }
  false
}

fn kill_dev_process(child: &mut Child, port: u16) {
  let pid = child.id();

  #[cfg(windows)]
  {
    let _ = Command::new("taskkill")
      .args(["/PID", &pid.to_string(), "/T", "/F"])
      .stdin(Stdio::null())
      .stdout(Stdio::null())
      .stderr(Stdio::null())
      .status();
  }

  #[cfg(unix)]
  {
    unsafe {
      let _ = libc::kill(-(pid as i32), libc::SIGTERM);
    }
    thread::sleep(Duration::from_millis(200));
    let _ = child.try_wait();
    if child.try_wait().map(|o| o.is_none()).unwrap_or(false) {
      unsafe {
        let _ = libc::kill(-(pid as i32), libc::SIGKILL);
      }
    }
    let _ = child.try_wait();
  }

  #[cfg(not(any(windows, unix)))]
  {
    let _ = child.kill();
    let _ = child.wait();
  }

  let _ = port;
}

fn spawn_npm_dev(webapp_dir: &Path, port: u16) -> Result<Child, String> {
  let port_str = port.to_string();

  #[cfg(windows)]
  {
    let mut cmd = Command::new("cmd.exe");
    cmd.args(["/C", "npm", "run", "dev"]);
    cmd.current_dir(webapp_dir);
    cmd.env("BRAIAN_WEBAPP_PORT", &port_str);
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd.spawn()
      .map_err(|e| format!("Failed to start npm (is Node.js installed and on PATH?): {e}"))
  }

  #[cfg(unix)]
  {
    let mut cmd = Command::new("sh");
    cmd.arg("-c").arg("npm run dev");
    cmd.current_dir(webapp_dir);
    cmd.env("BRAIAN_WEBAPP_PORT", &port_str);
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    use std::os::unix::process::CommandExt;
    unsafe {
      cmd.pre_exec(|| {
        libc::setsid();
        Ok(())
      });
    }
    cmd.spawn()
      .map_err(|e| format!("Failed to start npm (is Node.js installed and on PATH?): {e}"))
  }

  #[cfg(not(any(windows, unix)))]
  {
    Err("Unsupported platform for workspace webapp dev server.".to_string())
  }
}

/// Stop every tracked dev server (app shutdown).
pub fn webapp_dev_stop_all(app: &AppHandle) {
  let Some(state) = app.try_state::<WebappDevState>() else {
    return;
  };
  let mut map = match state.inner.lock() {
    Ok(m) => m,
    Err(_) => return,
  };
  for (_id, mut dev) in map.drain() {
    kill_dev_process(&mut dev.child, dev.port);
  }
}

#[tauri::command]
pub fn webapp_dev_start(
  app: AppHandle,
  state: State<'_, WebappDevState>,
  workspace_id: String,
) -> Result<WebappDevStartResult, String> {
  clear_last_error(&state, &workspace_id);

  let webapp_dir = webapp_dir_for(&app, &workspace_id)?;
  let pkg = webapp_dir.join("package.json");
  if !pkg.is_file() {
    let msg = format!(
      "No workspace webapp at {WEBAPP_RELATIVE_DIR}. Run init from the Webapp screen first."
    );
    set_last_error(&state, &workspace_id, msg.clone());
    return Err(msg);
  }

  {
    let mut map = state.inner.lock().map_err(|e| e.to_string())?;
    if let Some(mut existing) = map.remove(&workspace_id) {
      kill_dev_process(&mut existing.child, existing.port);
    }
  }

  clear_dev_log_buffer(&state.dev_logs, &workspace_id);

  let port = pick_free_port()?;
  let url = format!("http://127.0.0.1:{port}/");

  let mut child = spawn_npm_dev(&webapp_dir, port)?;

  let logs_arc = Arc::clone(&state.dev_logs);
  let ws_out = workspace_id.clone();
  spawn_dev_stream_reader(logs_arc, ws_out, "stdout", child.stdout.take());
  let logs_arc = Arc::clone(&state.dev_logs);
  let ws_err = workspace_id.clone();
  spawn_dev_stream_reader(logs_arc, ws_err, "stderr", child.stderr.take());

  if !wait_for_http_ready(&url, Duration::from_secs(45)) {
    let mut dev = RunningDev { child, port };
    kill_dev_process(&mut dev.child, dev.port);
    let msg =
      "Dev server did not become ready in time. Try `npm install` in .braian/webapp, then retry."
        .to_string();
    set_last_error(&state, &workspace_id, msg.clone());
    return Err(msg);
  }

  {
    let mut map = state.inner.lock().map_err(|e| e.to_string())?;
    map.insert(
      workspace_id,
      RunningDev {
        child,
        port,
      },
    );
  }

  Ok(WebappDevStartResult { port, url })
}

#[tauri::command]
pub fn webapp_dev_stop(
  app: AppHandle,
  state: State<'_, WebappDevState>,
  workspace_id: String,
) -> Result<(), String> {
  let mut map = state.inner.lock().map_err(|e| e.to_string())?;
  if let Some(mut dev) = map.remove(&workspace_id) {
    kill_dev_process(&mut dev.child, dev.port);
  }
  clear_last_error(&state, &workspace_id);
  let _ = app;
  Ok(())
}

#[tauri::command]
pub fn webapp_dev_status(
  app: AppHandle,
  state: State<'_, WebappDevState>,
  workspace_id: String,
) -> Result<WebappDevStatus, String> {
  let running = {
    let mut map = state.inner.lock().map_err(|e| e.to_string())?;
    if let Some(dev) = map.get_mut(&workspace_id) {
      match dev.child.try_wait() {
        Ok(Some(_)) => {
          map.remove(&workspace_id);
          false
        }
        Ok(None) => true,
        Err(_) => {
          map.remove(&workspace_id);
          false
        }
      }
    } else {
      false
    }
  };

  let last_error = state
    .last_error
    .lock()
    .ok()
    .and_then(|m| m.get(&workspace_id).cloned());

  let preview_path_stored = workspace::webapp_preview_path_get(&app, &workspace_id).ok();

  let (has_package_json, has_node_modules) = webapp_dir_for(&app, &workspace_id)
    .map(|p| {
      (
        p.join("package.json").is_file(),
        p.join("node_modules").is_dir(),
      )
    })
    .unwrap_or((false, false));

  if !running {
    return Ok(WebappDevStatus {
      running: false,
      has_package_json,
      has_node_modules,
      port: None,
      url: None,
      preview_path: preview_path_stored,
      preview_url: None,
      last_error: if has_package_json {
        last_error
      } else {
        Some(format!(
          "Webapp not initialized. Use Webapp settings (gear) or App mode to create {WEBAPP_RELATIVE_DIR}."
        ))
      },
    });
  }

  let (port, base_url) = {
    let map = state.inner.lock().map_err(|e| e.to_string())?;
    let dev = map
      .get(&workspace_id)
      .ok_or_else(|| "Dev server state missing.".to_string())?;
    (
      dev.port,
      format!("http://127.0.0.1:{}/", dev.port),
    )
  };

  let path_for_url = preview_path_stored
    .clone()
    .unwrap_or_else(|| "/".to_string());
  let preview_url = preview_url_for_port(port, &path_for_url);

  Ok(WebappDevStatus {
    running: true,
    has_package_json,
    has_node_modules,
    port: Some(port),
    url: Some(base_url),
    preview_path: Some(path_for_url),
    preview_url: Some(preview_url),
    last_error,
  })
}

#[tauri::command]
pub fn webapp_preview_path_set(
  app: AppHandle,
  workspace_id: String,
  path: String,
) -> Result<WebappPreviewPathSetResult, String> {
  let normalized = normalize_webapp_preview_path(&path)?;
  workspace::webapp_preview_path_set(&app, &workspace_id, &normalized)?;
  Ok(WebappPreviewPathSetResult {
    preview_path: normalized,
  })
}

#[tauri::command]
pub fn webapp_dev_logs(
  state: State<'_, WebappDevState>,
  workspace_id: String,
) -> Result<WebappDevLogsResult, String> {
  let text = state
    .dev_logs
    .lock()
    .map_err(|e| e.to_string())?
    .get(&workspace_id)
    .map(|v| String::from_utf8_lossy(v).into_owned())
    .unwrap_or_default();
  Ok(WebappDevLogsResult { text })
}

fn template_source_dir(app: &AppHandle) -> Result<PathBuf, String> {
  let resolved = app
    .path()
    .resolve("webapp-template", BaseDirectory::Resource)
    .map_err(|e| e.to_string())?;
  if resolved.is_dir() {
    return Ok(resolved);
  }
  // Dev fallback: template next to manifest dir (cargo project).
  let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
  let fallback = manifest_dir.join("resources/webapp-template");
  if fallback.is_dir() {
    return Ok(fallback);
  }
  Err(format!(
    "Bundled webapp template not found (expected Resource webapp-template or {}/resources/webapp-template).",
    manifest_dir.display()
  ))
}

fn copy_template_recursive(
  src: &Path,
  dst: &Path,
  overwrite: bool,
) -> Result<(usize, usize), String> {
  let mut copied = 0usize;
  let mut skipped = 0usize;

  for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
    let entry = entry.map_err(|e| e.to_string())?;
    let file_type = entry.file_type().map_err(|e| e.to_string())?;
    let name = entry.file_name();
    let src_path = entry.path();
    let dst_path = dst.join(&name);

    if file_type.is_dir() {
      let (c, s) = copy_template_recursive(&src_path, &dst_path, overwrite)?;
      copied += c;
      skipped += s;
      continue;
    }

    if !file_type.is_file() {
      continue;
    }

    if dst_path.exists() && !overwrite {
      skipped += 1;
      continue;
    }

    if let Some(parent) = dst_path.parent() {
      fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::copy(&src_path, &dst_path).map_err(|e| e.to_string())?;
    copied += 1;
  }

  Ok((copied, skipped))
}

#[tauri::command]
pub fn webapp_init_from_template(
  app: AppHandle,
  workspace_id: String,
  overwrite: Option<bool>,
) -> Result<WebappInitResult, String> {
  let overwrite = overwrite.unwrap_or(false);
  let webapp_dir = webapp_dir_for(&app, &workspace_id)?;
  let pkg = webapp_dir.join("package.json");

  if pkg.is_file() && !overwrite {
    return Err(
      "Workspace webapp already exists (.braian/webapp/package.json). Pass overwrite=true to replace files from the template."
        .to_string(),
    );
  }

  fs::create_dir_all(&webapp_dir).map_err(|e| e.to_string())?;

  let template_dir = template_source_dir(&app)?;
  let (copied, skipped_count) = copy_template_recursive(&template_dir, &webapp_dir, overwrite)?;

  Ok(WebappInitResult {
    copied_files: copied,
    skipped_existing: skipped_count > 0 && !overwrite,
  })
}
