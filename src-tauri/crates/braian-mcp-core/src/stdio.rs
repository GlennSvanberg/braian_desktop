use std::fs;
use std::io::{self, BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use serde_json::Value;

/// Extra directories prepended to PATH so node CLIs resolve in GUI launches.
fn extra_path_prefixes_for_node_cli() -> Vec<PathBuf> {
  let mut v: Vec<PathBuf> = Vec::new();

  #[cfg(windows)]
  {
    v.push(PathBuf::from(r"C:\Program Files\nodejs"));
    v.push(PathBuf::from(r"C:\Program Files (x86)\nodejs"));
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
      v.push(Path::new(&local).join("Programs").join("node"));
    }
    if let Ok(roam) = std::env::var("APPDATA") {
      v.push(Path::new(&roam).join("npm"));
    }
  }

  #[cfg(target_os = "macos")]
  {
    v.push(PathBuf::from("/opt/homebrew/bin"));
    v.push(PathBuf::from("/usr/local/bin"));
  }

  #[cfg(all(unix, not(target_os = "macos")))]
  {
    v.push(PathBuf::from("/usr/local/bin"));
  }

  if let Ok(node_home) = std::env::var("NODE_HOME") {
    if !node_home.is_empty() {
      let p = PathBuf::from(&node_home);
      v.push(p.join("bin"));
      v.push(p);
    }
  }
  if let Ok(volta) = std::env::var("VOLTA_HOME") {
    if !volta.is_empty() {
      v.push(Path::new(&volta).join("bin"));
    }
  }
  v
}

fn prepend_existing_dirs_to_path(base: &str) -> String {
  #[cfg(windows)]
  let sep = ';';
  #[cfg(not(windows))]
  let sep = ':';

  let mut seen = std::collections::HashSet::<String>::new();
  let mut parts: Vec<String> = Vec::new();
  for dir in extra_path_prefixes_for_node_cli() {
    if !dir.is_dir() {
      continue;
    }
    let Some(s) = dir.to_str().map(|t| t.trim_end_matches(['/', '\\'])) else {
      continue;
    };
    if s.is_empty() {
      continue;
    }
    let key = s.to_lowercase();
    if !seen.insert(key) {
      continue;
    }
    parts.push(s.to_string());
  }
  if parts.is_empty() {
    return base.to_string();
  }
  let prefix = parts.join(&sep.to_string());
  if base.trim().is_empty() {
    prefix
  } else {
    format!("{prefix}{sep}{base}")
  }
}

fn safe_join_workspace(root: &Path, rel: &str) -> Result<PathBuf, String> {
  let candidate = root.join(rel);
  let canon_root = root.canonicalize().map_err(|e| e.to_string())?;
  let canon = candidate.canonicalize().map_err(|e| e.to_string())?;
  if !canon.starts_with(&canon_root) {
    return Err("Path escapes workspace.".to_string());
  }
  Ok(canon)
}

fn apply_mcp_stdio_path(entry: &serde_json::Map<String, Value>, cmd: &mut Command) {
  let parent_path = std::env::var("PATH").unwrap_or_default();
  let base_path = entry
    .get("env")
    .and_then(|e| e.as_object())
    .and_then(|m| m.get("PATH"))
    .and_then(|v| v.as_str())
    .unwrap_or(&parent_path);
  let augmented = prepend_existing_dirs_to_path(base_path);
  cmd.env("PATH", augmented);
}

/// Stdio MCP (e.g. `uv run`, `npx`) can exceed 25s on cold start (deps, JIT).
pub const MCP_RPC_DEADLINE: Duration = Duration::from_secs(120);
pub const MCP_STDERR_CAP: usize = 12_000;
pub const MCP_MAX_TOOL_RESULT_CHARS: usize = 512 * 1024;

pub fn resolve_stdio_cwd(
  workspace_root: &Path,
  canon_root: &Path,
  entry: &serde_json::Map<String, Value>,
) -> Result<PathBuf, String> {
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

pub fn spawn_stdio_server(
  workspace_root: &Path,
  canon_root: &Path,
  entry: &serde_json::Map<String, Value>,
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
  let mut cmd = command_for_host(command, &args);
  cmd.current_dir(&cwd_path);
  cmd.stdin(Stdio::piped());
  cmd.stdout(Stdio::piped());
  cmd.stderr(Stdio::piped());
  apply_mcp_stdio_path(entry, &mut cmd);
  if let Some(env_obj) = entry.get("env").and_then(|e| e.as_object()) {
    for (k, v) in env_obj {
      if k == "PATH" {
        continue;
      }
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

/// On Windows, `npx` / `npm` are `.cmd` shims; `Command::new("npx")` does not resolve them.
fn command_for_host(program: &str, args: &[String]) -> Command {
  #[cfg(windows)]
  {
    let lc = program.to_ascii_lowercase();
    if matches!(
      lc.as_str(),
      "npx" | "npm" | "pnpm" | "yarn" | "corepack" | "uv" | "uvx"
    ) {
      let comspec = std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string());
      let mut c = Command::new(comspec);
      c.arg("/c");
      c.arg(program);
      c.args(args);
      return c;
    }
  }
  let mut c = Command::new(program);
  c.args(args);
  c
}

pub fn read_response_for_id(
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
    let v: Value = serde_json::from_str(line).map_err(|e| {
      format!(
        "Non-JSON line from MCP: {e}: {}",
        line.chars().take(200).collect::<String>()
      )
    })?;
    if let Some(id) = v.get("id").and_then(|i| i.as_i64()) {
      if id == want_id {
        return Ok(v);
      }
    }
  }
}

pub fn trim_stderr(s: &str) -> String {
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

/// Read one MCP stdio message: **Content-Length** framing (spec) or a single NDJSON line.
pub fn read_next_stdio_mcp_message<R: Read>(
  reader: &mut BufReader<R>,
) -> io::Result<Option<String>> {
  let mut line = String::new();
  loop {
    line.clear();
    let n = reader.read_line(&mut line)?;
    if n == 0 {
      return Ok(None);
    }
    let trimmed = line.trim_end_matches(['\r', '\n']);
    if trimmed.is_empty() {
      continue;
    }
    let body = if trimmed
      .to_ascii_lowercase()
      .starts_with("content-length:")
    {
      let rest = trimmed[trimmed.find(':').map(|i| i + 1).unwrap_or(trimmed.len())..].trim();
      let byte_len = rest
        .parse::<usize>()
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
      let mut blank = String::new();
      reader.read_line(&mut blank)?;
      let mut buf = vec![0u8; byte_len];
      reader.read_exact(&mut buf)?;
      String::from_utf8_lossy(&buf).into_owned()
    } else {
      trimmed.to_string()
    };
    return Ok(Some(body));
  }
}

pub fn start_stdout_line_channel(
  stdout: std::process::ChildStdout,
) -> (mpsc::Receiver<String>, std::thread::JoinHandle<()>) {
  start_stdout_mcp_message_channel(stdout)
}

/// MCP stdio transport uses **Content-Length**-prefixed messages (spec). Some clients/servers
/// use a single JSON line per message (NDJSON). This reader supports both.
pub fn start_stdout_mcp_message_channel(
  stdout: std::process::ChildStdout,
) -> (mpsc::Receiver<String>, std::thread::JoinHandle<()>) {
  let (tx, rx) = mpsc::channel::<String>();
  let handle = std::thread::spawn(move || {
    let mut reader = BufReader::new(stdout);
    loop {
      let msg = match read_next_stdio_mcp_message(&mut reader) {
        Ok(Some(s)) => s,
        Ok(None) => break,
        Err(_) => break,
      };
      if tx.send(msg).is_err() {
        break;
      }
    }
  });
  (rx, handle)
}

#[cfg(test)]
mod mcp_stdio_framing_tests {
  use super::*;
  use std::io::Cursor;

  #[test]
  fn content_length_framing() {
    let raw = b"Content-Length: 11\r\n\r\n{\"ok\":true}";
    let mut r = BufReader::new(Cursor::new(raw));
    let m = read_next_stdio_mcp_message(&mut r).unwrap().unwrap();
    assert_eq!(m, r#"{"ok":true}"#);
  }

  #[test]
  fn ndjson_line() {
    let raw = b"{\"jsonrpc\":\"2.0\",\"id\":1}\n";
    let mut r = BufReader::new(Cursor::new(raw));
    let m = read_next_stdio_mcp_message(&mut r).unwrap().unwrap();
    assert!(m.contains("jsonrpc"));
  }
}

pub fn write_json_line(stdin: &mut impl Write, value: &Value) -> Result<(), String> {
  let s = serde_json::to_string(value).map_err(|e| e.to_string())?;
  writeln!(stdin, "{}", s).map_err(|e| e.to_string())?;
  stdin.flush().map_err(|e| e.to_string())
}

pub fn mcp_tool_result_content_string(result: &Value) -> String {
  if let Some(content) = result.get("content").and_then(|c| c.as_array()) {
    let mut parts: Vec<String> = Vec::new();
    for item in content {
      if let Some(t) = item.get("type").and_then(|x| x.as_str()) {
        if t == "text" {
          if let Some(text) = item.get("text").and_then(|x| x.as_str()) {
            parts.push(text.to_string());
            continue;
          }
        }
      }
      parts.push(item.to_string());
    }
    if !parts.is_empty() {
      return parts.join("\n");
    }
  }
  if let Some(sc) = result.get("structuredContent") {
    return serde_json::to_string_pretty(sc).unwrap_or_else(|_| sc.to_string());
  }
  serde_json::to_string_pretty(result).unwrap_or_else(|_| "{}".to_string())
}

pub fn mcp_tool_call_finalize_string(result: &Value) -> Result<String, String> {
  if result.get("isError").and_then(|b| b.as_bool()) == Some(true) {
    let s = mcp_tool_result_content_string(result);
    return Err(if s.is_empty() {
      "Tool returned isError.".to_string()
    } else {
      s
    });
  }
  let mut s = mcp_tool_result_content_string(result);
  if s.chars().count() > MCP_MAX_TOOL_RESULT_CHARS {
    s = s.chars().take(MCP_MAX_TOOL_RESULT_CHARS).collect::<String>() + "…";
  }
  Ok(s)
}
