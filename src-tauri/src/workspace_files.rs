use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::AppHandle;
use uuid::Uuid;

use crate::braian_store::workspace_root_path;
use crate::db;

const DEFAULT_MAX_READ: u64 = 512 * 1024;

fn safe_join_workspace(workspace_root: &Path, relative_path: &str) -> Result<PathBuf, String> {
  if relative_path.is_empty() || relative_path.contains('\0') {
    return Err("Invalid path.".to_string());
  }
  let canon_root = workspace_root.canonicalize().map_err(|e| e.to_string())?;
  let mut out = canon_root.clone();
  for seg in relative_path
    .split(['/', '\\'])
    .filter(|s| !s.is_empty() && *s != ".")
  {
    if seg == ".." {
      return Err("Path must not contain parent directory segments.".to_string());
    }
    if seg.contains(':') {
      return Err("Invalid path segment.".to_string());
    }
    out.push(seg);
  }
  if !out.starts_with(&canon_root) {
    return Err("Path escapes workspace.".to_string());
  }
  Ok(out)
}

fn canonical_file_under_workspace(
  workspace_root: &Path,
  relative_path: &str,
) -> Result<PathBuf, String> {
  let full = safe_join_workspace(workspace_root, relative_path)?;
  let meta = fs::metadata(&full).map_err(|e| e.to_string())?;
  if !meta.is_file() {
    return Err("Not a file or path is not accessible.".to_string());
  }
  let canon_root = workspace_root.canonicalize().map_err(|e| e.to_string())?;
  let canon_file = full.canonicalize().map_err(|e| e.to_string())?;
  if !canon_file.starts_with(&canon_root) {
    return Err("Path escapes workspace.".to_string());
  }
  Ok(canon_file)
}

/// Relative path using forward slashes from workspace root.
fn relative_path_display(workspace_root: &Path, absolute: &Path) -> Result<String, String> {
  let canon_root = workspace_root.canonicalize().map_err(|e| e.to_string())?;
  let canon_file = absolute.canonicalize().map_err(|e| e.to_string())?;
  let rel = canon_file
    .strip_prefix(&canon_root)
    .map_err(|_| "Path not under workspace.".to_string())?;
  Ok(rel
    .components()
    .map(|c| c.as_os_str().to_string_lossy())
    .collect::<Vec<_>>()
    .join("/"))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceReadTextFileResult {
  pub text: String,
  pub truncated: bool,
}

#[tauri::command]
pub fn workspace_read_text_file(
  app: AppHandle,
  workspace_id: String,
  relative_path: String,
  max_bytes: Option<u64>,
) -> Result<WorkspaceReadTextFileResult, String> {
  let conn = db::open_connection(&app).map_err(|e| e.to_string())?;
  let root = workspace_root_path(&conn, &workspace_id)?;
  let path = canonical_file_under_workspace(&root, relative_path.trim())?;
  let cap = max_bytes.unwrap_or(DEFAULT_MAX_READ).min(2 * 1024 * 1024);
  let len = fs::metadata(&path).map_err(|e| e.to_string())?.len();
  let truncated = len > cap;
  let f = fs::File::open(&path).map_err(|e| e.to_string())?;
  let mut buf = Vec::new();
  f.take(cap)
    .read_to_end(&mut buf)
    .map_err(|e| e.to_string())?;
  let text = if truncated {
    let mut end = buf.len();
    while end > 0 && std::str::from_utf8(&buf[..end]).is_err() {
      end -= 1;
    }
    std::str::from_utf8(&buf[..end])
      .map_err(|_| "File is not valid UTF-8.".to_string())?
      .to_string()
  } else {
    String::from_utf8(buf).map_err(|_| {
      "File is not valid UTF-8 (binary files are not supported for chat context).".to_string()
    })?
  };
  Ok(WorkspaceReadTextFileResult { text, truncated })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceImportFileResult {
  pub relative_path: String,
  pub display_name: String,
}

#[tauri::command]
pub fn workspace_import_file(
  app: AppHandle,
  workspace_id: String,
  conversation_id: Option<String>,
  source_path: String,
) -> Result<WorkspaceImportFileResult, String> {
  let src = PathBuf::from(source_path.trim());
  if !src.is_file() {
    return Err("Source is not a file.".to_string());
  }
  let conn = db::open_connection(&app).map_err(|e| e.to_string())?;
  let root = workspace_root_path(&conn, &workspace_id)?;
  let canon_root = root.canonicalize().map_err(|e| e.to_string())?;

  let folder = conversation_id
    .as_ref()
    .map(|s| s.trim())
    .filter(|s| !s.is_empty())
    .unwrap_or("unsaved");
  let uploads = safe_join_workspace(&root, ".braian")?;
  let uploads = uploads.join("uploads").join(folder);
  fs::create_dir_all(&uploads).map_err(|e| e.to_string())?;
  let uploads_canon = uploads.canonicalize().map_err(|e| e.to_string())?;
  if !uploads_canon.starts_with(&canon_root) {
    return Err("Upload path escapes workspace.".to_string());
  }

  let orig_name = src
    .file_name()
    .and_then(|n| n.to_str())
    .filter(|s| !s.is_empty())
    .unwrap_or("file");
  let safe_name: String = orig_name
    .chars()
    .map(|c| match c {
      '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' | '\0' => '-',
      c if c.is_control() => '-',
      c => c,
    })
    .collect();
  let unique = format!("{}_{}", Uuid::new_v4(), safe_name);
  let dest = uploads_canon.join(unique);
  fs::copy(&src, &dest).map_err(|e| e.to_string())?;

  let rel = relative_path_display(&root, &dest)?;
  Ok(WorkspaceImportFileResult {
    relative_path: rel,
    display_name: orig_name.to_string(),
  })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDirEntryDto {
  pub name: String,
  pub relative_path: String,
  pub is_dir: bool,
}

/// Shallow listing of one directory under the workspace (for file browser).
#[tauri::command]
pub fn workspace_list_dir(
  app: AppHandle,
  workspace_id: String,
  relative_dir: String,
) -> Result<Vec<WorkspaceDirEntryDto>, String> {
  let conn = db::open_connection(&app).map_err(|e| e.to_string())?;
  let root = workspace_root_path(&conn, &workspace_id)?;
  let rel = relative_dir.trim();
  let dir_path = if rel.is_empty() {
    root.canonicalize().map_err(|e| e.to_string())?
  } else {
    let full = safe_join_workspace(&root, rel)?;
    let meta = fs::metadata(&full).map_err(|e| e.to_string())?;
    if !meta.is_dir() {
      return Err("Not a directory.".to_string());
    }
    full.canonicalize().map_err(|e| e.to_string())?
  };
  let canon_root = root.canonicalize().map_err(|e| e.to_string())?;
  if !dir_path.starts_with(&canon_root) {
    return Err("Path escapes workspace.".to_string());
  }

  let mut entries: Vec<WorkspaceDirEntryDto> = Vec::new();
  for entry in fs::read_dir(&dir_path).map_err(|e| e.to_string())? {
    let entry = entry.map_err(|e| e.to_string())?;
    let name = entry
      .file_name()
      .to_string_lossy()
      .to_string();
    if name == "." || name == ".." {
      continue;
    }
    let path = entry.path();
    let is_dir = entry
      .file_type()
      .map_err(|e| e.to_string())?
      .is_dir();
    let rel_display = relative_path_display(&root, &path)?;
    entries.push(WorkspaceDirEntryDto {
      name,
      relative_path: rel_display,
      is_dir,
    });
  }
  entries.sort_by(|a, b| {
    match (a.is_dir, b.is_dir) {
      (true, false) => std::cmp::Ordering::Less,
      (false, true) => std::cmp::Ordering::Greater,
      _ => a
        .name
        .to_lowercase()
        .cmp(&b.name.to_lowercase()),
    }
  });
  Ok(entries)
}

const WORKSPACE_FILE_WALK_MAX: usize = 8_000;

const SKIP_WALK_DIR_NAMES: &[&str] = &[
  ".git",
  "node_modules",
  "target",
  "dist",
  "build",
  ".next",
  ".turbo",
  ".vite",
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFileIndexEntry {
  pub relative_path: String,
  pub name: String,
}

fn collect_workspace_files_recursive(
  canon_root: &Path,
  dir: &Path,
  relative_prefix: &str,
  out: &mut Vec<WorkspaceFileIndexEntry>,
) -> Result<(), String> {
  if out.len() >= WORKSPACE_FILE_WALK_MAX {
    return Ok(());
  }
  for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
    let entry = entry.map_err(|e| e.to_string())?;
    if out.len() >= WORKSPACE_FILE_WALK_MAX {
      break;
    }
    let name = entry.file_name().to_string_lossy().to_string();
    if name == "." || name == ".." {
      continue;
    }
    let path = entry.path();
    let meta = entry.metadata().map_err(|e| e.to_string())?;
    if meta.is_dir() {
      if SKIP_WALK_DIR_NAMES.contains(&name.as_str()) {
        continue;
      }
      let next_prefix = if relative_prefix.is_empty() {
        name.clone()
      } else {
        format!("{relative_prefix}/{name}")
      };
      collect_workspace_files_recursive(canon_root, &path, &next_prefix, out)?;
    } else if meta.is_file() {
      let rel_path = if relative_prefix.is_empty() {
        name.clone()
      } else {
        format!("{relative_prefix}/{name}")
      };
      let canon_file = path.canonicalize().map_err(|e| e.to_string())?;
      if !canon_file.starts_with(&canon_root) {
        continue;
      }
      out.push(WorkspaceFileIndexEntry {
        relative_path: rel_path.replace('\\', "/"),
        name,
      });
    }
  }
  Ok(())
}

/// All files under the workspace (recursive), excluding heavy common folders.
#[tauri::command]
pub fn workspace_list_all_files(
  app: AppHandle,
  workspace_id: String,
) -> Result<Vec<WorkspaceFileIndexEntry>, String> {
  let conn = db::open_connection(&app).map_err(|e| e.to_string())?;
  let root = workspace_root_path(&conn, &workspace_id)?;
  let canon = root.canonicalize().map_err(|e| e.to_string())?;
  let mut out: Vec<WorkspaceFileIndexEntry> = Vec::new();
  collect_workspace_files_recursive(&canon, &canon, "", &mut out)?;
  out.sort_by(|a, b| a.relative_path.to_lowercase().cmp(&b.relative_path.to_lowercase()));
  Ok(out)
}
