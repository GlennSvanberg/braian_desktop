use std::fs;
use std::io::{self, BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::Value;

/// Log target filter: set `RUST_LOG=braian_mcp_stdio=debug` (mcpd) or the same in the desktop app.
pub const MCP_STDIO_LOG_TARGET: &str = "braian_mcp_stdio";

/// Shell used to run `npx` / `npm` `.cmd` shims on Windows.
///
/// Tauri/GUI processes often inherit a `PATH` without `System32`, so `Command::new("cmd.exe")`
/// fails with "program not found". Prefer `COMSPEC` when it points at an existing file;
/// otherwise use `%SystemRoot%\System32\cmd.exe`.
#[cfg(windows)]
pub fn windows_shell_for_shim_commands() -> PathBuf {
    if let Ok(comspec) = std::env::var("COMSPEC") {
        let t = comspec.trim();
        if !t.is_empty() {
            let p = PathBuf::from(t);
            if p.exists() {
                return p;
            }
        }
    }
    std::env::var("SystemRoot")
        .or_else(|_| std::env::var("WINDIR"))
        .map(|root| PathBuf::from(root).join("System32").join("cmd.exe"))
        .unwrap_or_else(|_| PathBuf::from(r"C:\Windows\System32\cmd.exe"))
}

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
        if let Ok(nvm_symlink) = std::env::var("NVM_SYMLINK") {
            if !nvm_symlink.is_empty() {
                v.push(PathBuf::from(nvm_symlink));
            }
        }
        if let Ok(nvm_home) = std::env::var("NVM_HOME") {
            if !nvm_home.is_empty() {
                v.push(Path::new(&nvm_home).join("node"));
            }
        }
        if let Ok(home) = std::env::var("USERPROFILE") {
            let h = Path::new(&home);
            v.push(h.join("scoop").join("shims"));
            v.push(h.join("scoop").join("apps").join("nodejs").join("current"));
        }
        v.push(PathBuf::from(r"C:\ProgramData\chocolatey\bin"));
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
    if let Ok(fnm_ms) = std::env::var("FNM_MULTISHELL_PATH") {
        if !fnm_ms.is_empty() {
            v.push(PathBuf::from(fnm_ms));
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

/// Same `PATH` string later applied to the child process. Used to resolve `npx.cmd` / `npm.cmd`
/// **before** spawn (GUI apps often lack Node on `PATH` until we prepend these dirs).
pub fn augmented_path_env_for_stdio_entry(entry: &serde_json::Map<String, Value>) -> String {
    let parent_path = std::env::var("PATH").unwrap_or_default();
    let base_path = entry
        .get("env")
        .and_then(|e| e.as_object())
        .and_then(|m| m.get("PATH"))
        .and_then(|v| v.as_str())
        .unwrap_or(&parent_path);
    prepend_existing_dirs_to_path(base_path)
}

/// Applies the same augmented `PATH` used for shim resolution and spawn (single source of truth).
pub fn apply_augmented_path_to_command(cmd: &mut Command, augmented_path: &str) {
    cmd.env("PATH", augmented_path);
}

fn path_segments_iter(path_env: &str) -> impl Iterator<Item = &str> + '_ {
    #[cfg(windows)]
    {
        path_env.split(';')
    }
    #[cfg(not(windows))]
    {
        path_env.split(':')
    }
}

/// Locate `npx.cmd` / `npm.cmd` / … on an augmented PATH (`;` on Windows, `:` elsewhere).
pub fn find_cmd_shim_on_path(program: &str, path_env: &str) -> Option<PathBuf> {
    let p = Path::new(program);
    if p.is_absolute() && p.is_file() {
        return Some(p.to_path_buf());
    }
    let stem = Path::new(program)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(program);
    let names = [
        format!("{stem}.cmd"),
        format!("{stem}.exe"),
        stem.to_string(),
    ];
    for segment in path_segments_iter(path_env) {
        let segment = segment.trim();
        if segment.is_empty() {
            continue;
        }
        let dir = Path::new(segment);
        if !dir.is_dir() {
            continue;
        }
        for name in &names {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

fn build_stdio_command_for_mcp(
    entry: &serde_json::Map<String, Value>,
    program: &str,
    args: &[String],
    augmented_path: &str,
) -> Command {
    #[cfg(windows)]
    {
        let lc = program.to_ascii_lowercase();
        if matches!(
            lc.as_str(),
            "npx" | "npm" | "pnpm" | "yarn" | "corepack" | "uv" | "uvx"
        ) {
            let mut c = Command::new(windows_shell_for_shim_commands());
            c.arg("/c");
            if let Some(shim) = find_cmd_shim_on_path(program, augmented_path) {
                c.arg(shim);
            } else {
                c.arg(program);
            }
            c.args(args);
            return c;
        }
        let _ = entry;
    }
    #[cfg(not(windows))]
    let _ = entry;
    let mut c = Command::new(program);
    c.args(args);
    c
}

/// Builds `Command` for stdio MCP (computes augmented PATH once internally).
pub fn command_for_stdio_mcp(
    entry: &serde_json::Map<String, Value>,
    program: &str,
    args: &[String],
) -> Command {
    let aug = augmented_path_env_for_stdio_entry(entry);
    build_stdio_command_for_mcp(entry, program, args, &aug)
}

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
        let body = if trimmed.to_ascii_lowercase().starts_with("content-length:") {
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

/// MCP stdio transport uses **Content-Length**-prefixed messages (spec). Some clients/servers
/// use a single JSON line per message (NDJSON). This reader supports both.
pub fn start_stdout_mcp_message_channel(
    stdout: std::process::ChildStdout,
) -> (
    std::sync::mpsc::Receiver<String>,
    std::thread::JoinHandle<()>,
) {
    let (tx, rx) = std::sync::mpsc::channel::<String>();
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
        s = s
            .chars()
            .take(MCP_MAX_TOOL_RESULT_CHARS)
            .collect::<String>()
            + "…";
    }
    Ok(s)
}
