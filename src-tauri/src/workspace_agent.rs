use std::fs;
use std::io::Read;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::AppHandle;

use crate::braian_store::workspace_root_path;
use crate::db;
use crate::workspace_files::safe_join_workspace;

const DEFAULT_TIMEOUT_MS: u64 = 120_000;
const DEFAULT_MAX_OUTPUT_BYTES: usize = 256 * 1024;
const TRUNC_SUFFIX: &str = "\n[... output truncated by Braian ...]\n";

fn truncate_utf8(bytes: &[u8], max: usize) -> String {
  if bytes.len() <= max {
    return String::from_utf8_lossy(bytes).into_owned();
  }
  let mut end = max;
  while end > 0 && std::str::from_utf8(&bytes[..end]).is_err() {
    end -= 1;
  }
  let mut s = String::from_utf8_lossy(&bytes[..end]).into_owned();
  s.push_str(TRUNC_SUFFIX);
  s
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRunCommandResult {
  pub exit_code: Option<i32>,
  pub stdout: String,
  pub stderr: String,
  pub timed_out: bool,
}

/// Run a program with argv (no shell). `cwd` is optional, relative to workspace root; default is workspace root.
#[tauri::command]
pub fn workspace_run_command(
  app: AppHandle,
  workspace_id: String,
  program: String,
  args: Vec<String>,
  cwd: Option<String>,
  timeout_ms: Option<u64>,
  max_output_bytes: Option<usize>,
) -> Result<WorkspaceRunCommandResult, String> {
  let program = program.trim();
  if program.is_empty() {
    return Err("Program name cannot be empty.".to_string());
  }

  let conn = db::open_connection(&app).map_err(|e| e.to_string())?;
  let root = workspace_root_path(&conn, &workspace_id)?;
  let canon_root = root.canonicalize().map_err(|e| e.to_string())?;

  let cwd_path = match cwd.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
    None | Some("") => canon_root.clone(),
    Some(rel) => {
      let p = safe_join_workspace(&root, rel)?;
      let meta = fs::metadata(&p).map_err(|e| e.to_string())?;
      if !meta.is_dir() {
        return Err("Working directory is not a directory.".to_string());
      }
      p.canonicalize().map_err(|e| e.to_string())?
    }
  };

  if !cwd_path.starts_with(&canon_root) {
    return Err("Working directory escapes workspace.".to_string());
  }

  let timeout = Duration::from_millis(
    timeout_ms
      .unwrap_or(DEFAULT_TIMEOUT_MS)
      .clamp(1_000, 600_000),
  );
  let max_each = max_output_bytes
    .unwrap_or(DEFAULT_MAX_OUTPUT_BYTES)
    .clamp(4_096, 2 * 1024 * 1024);

  let mut cmd = Command::new(program);
  cmd.args(&args);
  cmd.current_dir(&cwd_path);
  cmd.stdout(Stdio::piped());
  cmd.stderr(Stdio::piped());
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    cmd.creation_flags(CREATE_NO_WINDOW);
  }

  let mut child = cmd
    .spawn()
    .map_err(|e| format!("Failed to start `{program}`: {e}"))?;

  let stdout = child.stdout.take();
  let stderr = child.stderr.take();

  let stdout_handle = thread::spawn(move || {
    let mut v = Vec::new();
    if let Some(mut h) = stdout {
      let _ = h.read_to_end(&mut v);
    }
    v
  });
  let stderr_handle = thread::spawn(move || {
    let mut v = Vec::new();
    if let Some(mut h) = stderr {
      let _ = h.read_to_end(&mut v);
    }
    v
  });

  let start = Instant::now();
  let mut timed_out = false;
  let exit_code = loop {
    if start.elapsed() >= timeout {
      timed_out = true;
      let _ = child.kill();
      break child.wait().ok().and_then(|s| s.code());
    }
    match child.try_wait() {
      Ok(Some(status)) => break status.code(),
      Ok(None) => thread::sleep(Duration::from_millis(25)),
      Err(e) => return Err(e.to_string()),
    }
  };
  let stdout_bytes = stdout_handle.join().unwrap_or_default();
  let stderr_bytes = stderr_handle.join().unwrap_or_default();

  let stdout = truncate_utf8(&stdout_bytes, max_each);
  let stderr = truncate_utf8(&stderr_bytes, max_each);

  Ok(WorkspaceRunCommandResult {
    exit_code,
    stdout,
    stderr,
    timed_out,
  })
}
