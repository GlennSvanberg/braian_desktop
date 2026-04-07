use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::AppHandle;

use crate::braian_store::workspace_root_path;
use crate::db;
use crate::workspace_hub;

const DEFAULT_MAX_READ: u64 = 512 * 1024;

pub(crate) fn safe_join_workspace(
  workspace_root: &Path,
  relative_path: &str,
) -> Result<PathBuf, String> {
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

/// Create parent directories as needed and write UTF-8 text. Path is relative to workspace root.
#[tauri::command]
pub fn workspace_write_text_file(
  app: AppHandle,
  workspace_id: String,
  relative_path: String,
  content: String,
) -> Result<(), String> {
  let conn = db::open_connection(&app).map_err(|e| e.to_string())?;
  let root = workspace_root_path(&conn, &workspace_id)?;
  let path = safe_join_workspace(&root, relative_path.trim())?;
  let canon_root = root.canonicalize().map_err(|e| e.to_string())?;
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
  }
  fs::write(&path, content.as_bytes()).map_err(|e| e.to_string())?;
  let canon_file = path.canonicalize().map_err(|e| e.to_string())?;
  if !canon_file.starts_with(&canon_root) {
    return Err("Path escapes workspace.".to_string());
  }
  let rel_display = relative_path_display(&root, &canon_file).unwrap_or_else(|_| relative_path.trim().replace('\\', "/"));
  if let Err(e) = workspace_hub::recent_file_touch_internal(&root, &rel_display, None) {
    log::warn!("recent file touch after write: {e}");
  }
  Ok(())
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
  source_path: String,
) -> Result<WorkspaceImportFileResult, String> {
  let src = PathBuf::from(source_path.trim());
  if !src.is_file() {
    return Err("Source is not a file.".to_string());
  }
  let conn = db::open_connection(&app).map_err(|e| e.to_string())?;
  let root = workspace_root_path(&conn, &workspace_id)?;
  let canon_root = root.canonicalize().map_err(|e| e.to_string())?;

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
  let dest = unique_path_in_dir(&canon_root, &safe_name)?;
  fs::copy(&src, &dest).map_err(|e| e.to_string())?;

  let rel = relative_path_display(&root, &dest)?;
  if let Err(e) = workspace_hub::recent_file_touch_internal(&root, &rel, Some(orig_name)) {
    log::warn!("recent file touch after import: {e}");
  }
  Ok(WorkspaceImportFileResult {
    relative_path: rel,
    display_name: orig_name.to_string(),
  })
}

/// Destination path using `filename` when free; otherwise `name-2.ext`, `name-3.ext`, …
fn unique_path_in_dir(dir: &Path, filename: &str) -> Result<PathBuf, String> {
  let candidate = dir.join(filename);
  if !candidate.exists() {
    return Ok(candidate);
  }
  let (stem, ext_suffix) = match filename.rfind('.') {
    Some(dot) if dot > 0 => (&filename[..dot], Some(&filename[dot..])),
    _ => (filename, None),
  };
  for n in 2_i32..10_000 {
    let name = match ext_suffix {
      Some(sfx) => format!("{stem}-{n}{sfx}"),
      None => format!("{stem}-{n}"),
    };
    let c = dir.join(name);
    if !c.exists() {
      return Ok(c);
    }
  }
  Err("Could not find a free file name in workspace root.".to_string())
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

fn sanitize_workspace_basename(name: &str) -> Result<String, String> {
  let t = name.trim();
  if t.is_empty() {
    return Err("Name is empty.".to_string());
  }
  if t == "." || t == ".." {
    return Err("Invalid name.".to_string());
  }
  if t.contains('/') || t.contains('\\') {
    return Err("Name must not contain path separators.".to_string());
  }
  let safe: String = t
    .chars()
    .map(|c| match c {
      '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' | '\0' => '-',
      c if c.is_control() => '-',
      c => c,
    })
    .collect();
  if safe.is_empty() || safe == "." || safe == ".." {
    return Err("Invalid name.".to_string());
  }
  Ok(safe)
}

/// Move a file or directory under the workspace to another parent directory (same basename).
#[tauri::command]
pub fn workspace_move_entry(
  app: AppHandle,
  workspace_id: String,
  from_relative: String,
  to_parent_relative: String,
) -> Result<String, String> {
  let conn = db::open_connection(&app).map_err(|e| e.to_string())?;
  let root = workspace_root_path(&conn, &workspace_id)?;
  let canon_root = root.canonicalize().map_err(|e| e.to_string())?;

  let from_path = safe_join_workspace(&root, from_relative.trim())?;
  if !from_path.exists() {
    return Err("Source does not exist.".to_string());
  }
  let from_path = from_path.canonicalize().map_err(|e| e.to_string())?;
  if !from_path.starts_with(&canon_root) {
    return Err("Path escapes workspace.".to_string());
  }

  let to_parent_path = if to_parent_relative.trim().is_empty() {
    canon_root.clone()
  } else {
    let full = safe_join_workspace(&root, to_parent_relative.trim())?;
    let meta = fs::metadata(&full).map_err(|e| e.to_string())?;
    if !meta.is_dir() {
      return Err("Destination parent is not a directory.".to_string());
    }
    full.canonicalize().map_err(|e| e.to_string())?
  };
  if !to_parent_path.starts_with(&canon_root) {
    return Err("Path escapes workspace.".to_string());
  }

  let file_name = from_path
    .file_name()
    .and_then(|n| n.to_str())
    .filter(|s| !s.is_empty())
    .ok_or_else(|| "Invalid source name.".to_string())?;

  let dest_path = to_parent_path.join(file_name);
  if from_path == dest_path {
    return relative_path_display(&root, &from_path);
  }
  if dest_path.exists() {
    return Err("A file or folder with that name already exists in the destination.".to_string());
  }

  let from_is_dir = fs::metadata(&from_path)
    .map_err(|e| e.to_string())?
    .is_dir();
  if from_is_dir {
    let from_rel = relative_path_display(&root, &from_path)?;
    let to_parent_display = if to_parent_relative.trim().is_empty() {
      String::new()
    } else {
      relative_path_display(&root, &to_parent_path)?
    };
    let prefix = format!("{from_rel}/");
    if !to_parent_display.is_empty()
      && (to_parent_display == from_rel || to_parent_display.starts_with(&prefix))
    {
      return Err("Cannot move a folder into itself or into its own subfolder.".to_string());
    }
  }

  fs::rename(&from_path, &dest_path).map_err(|e| e.to_string())?;
  let dest_canon = dest_path.canonicalize().map_err(|e| e.to_string())?;
  relative_path_display(&root, &dest_canon)
}

/// Rename a file or directory (basename only); path stays in the same parent folder.
#[tauri::command]
pub fn workspace_rename_entry(
  app: AppHandle,
  workspace_id: String,
  relative_path: String,
  new_name: String,
) -> Result<String, String> {
  let conn = db::open_connection(&app).map_err(|e| e.to_string())?;
  let root = workspace_root_path(&conn, &workspace_id)?;
  let canon_root = root.canonicalize().map_err(|e| e.to_string())?;

  let safe_new = sanitize_workspace_basename(&new_name)?;
  let from_path = safe_join_workspace(&root, relative_path.trim())?;
  if !from_path.exists() {
    return Err("Path does not exist.".to_string());
  }
  let from_path = from_path.canonicalize().map_err(|e| e.to_string())?;
  if !from_path.starts_with(&canon_root) {
    return Err("Path escapes workspace.".to_string());
  }

  let parent = from_path
    .parent()
    .ok_or_else(|| "Invalid path.".to_string())?;
  let dest_path = parent.join(&safe_new);
  if from_path == dest_path {
    return relative_path_display(&root, &from_path);
  }
  if dest_path.exists() {
    return Err("A file or folder with that name already exists.".to_string());
  }

  fs::rename(&from_path, &dest_path).map_err(|e| e.to_string())?;
  let dest_canon = dest_path.canonicalize().map_err(|e| e.to_string())?;
  relative_path_display(&root, &dest_canon)
}

/// Create a new directory under `relative_parent` (empty string = workspace root).
#[tauri::command]
pub fn workspace_create_dir(
  app: AppHandle,
  workspace_id: String,
  relative_parent: String,
  name: String,
) -> Result<String, String> {
  let conn = db::open_connection(&app).map_err(|e| e.to_string())?;
  let root = workspace_root_path(&conn, &workspace_id)?;
  let canon_root = root.canonicalize().map_err(|e| e.to_string())?;

  let safe_name = sanitize_workspace_basename(&name)?;
  let parent_path = if relative_parent.trim().is_empty() {
    canon_root.clone()
  } else {
    let full = safe_join_workspace(&root, relative_parent.trim())?;
    let meta = fs::metadata(&full).map_err(|e| e.to_string())?;
    if !meta.is_dir() {
      return Err("Parent is not a directory.".to_string());
    }
    full.canonicalize().map_err(|e| e.to_string())?
  };
  if !parent_path.starts_with(&canon_root) {
    return Err("Path escapes workspace.".to_string());
  }

  let dest = unique_path_in_dir(&parent_path, &safe_name)?;
  fs::create_dir(&dest).map_err(|e| e.to_string())?;
  let dest_canon = dest.canonicalize().map_err(|e| e.to_string())?;
  relative_path_display(&root, &dest_canon)
}

/// Delete a file or directory under the workspace (directories are removed recursively).
#[tauri::command]
pub fn workspace_delete_entry(
  app: AppHandle,
  workspace_id: String,
  relative_path: String,
) -> Result<(), String> {
  let rel = relative_path.trim();
  if rel.is_empty() {
    return Err("Cannot delete the workspace root.".to_string());
  }

  let conn = db::open_connection(&app).map_err(|e| e.to_string())?;
  let root = workspace_root_path(&conn, &workspace_id)?;
  let canon_root = root.canonicalize().map_err(|e| e.to_string())?;

  let path = safe_join_workspace(&root, rel)?;
  if !path.exists() {
    return Err("Path does not exist.".to_string());
  }
  let path = path.canonicalize().map_err(|e| e.to_string())?;
  if !path.starts_with(&canon_root) {
    return Err("Path escapes workspace.".to_string());
  }
  if path == canon_root {
    return Err("Cannot delete the workspace root.".to_string());
  }

  let meta = fs::metadata(&path).map_err(|e| e.to_string())?;
  if meta.is_dir() {
    fs::remove_dir_all(&path).map_err(|e| e.to_string())?;
  } else {
    fs::remove_file(&path).map_err(|e| e.to_string())?;
  }
  Ok(())
}

const WORKSPACE_FILE_WALK_MAX: usize = 8_000;

const SKIP_WALK_DIR_NAMES: &[&str] = &[
  ".braian",
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

// ---------------------------------------------------------------------------
// Text search
// ---------------------------------------------------------------------------

const SEARCH_MAX_FILE_BYTES: u64 = 1_024 * 1_024;
const SEARCH_MAX_MATCHES: usize = 200;
const SEARCH_MAX_FILES: usize = 5_000;
const SEARCH_MAX_LINE_LEN: usize = 500;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSearchMatch {
  pub relative_path: String,
  pub line_number: u32,
  pub line_text: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSearchResult {
  pub matches: Vec<WorkspaceSearchMatch>,
  pub truncated: bool,
  pub files_searched: u32,
}

fn matches_glob(name: &str, glob: &str) -> bool {
  if let Some(ext) = glob.strip_prefix("*.") {
    name.ends_with(&format!(".{ext}"))
  } else {
    name == glob
  }
}

fn search_file(
  path: &Path,
  relative_path: &str,
  pattern: &regex::Regex,
  out: &mut Vec<WorkspaceSearchMatch>,
  max_matches: usize,
) -> Result<bool, ()> {
  let meta = fs::metadata(path).map_err(|_| ())?;
  if meta.len() > SEARCH_MAX_FILE_BYTES {
    return Ok(false);
  }
  let bytes = fs::read(path).map_err(|_| ())?;
  let text = match std::str::from_utf8(&bytes) {
    Ok(t) => t,
    Err(_) => return Ok(false),
  };
  for (idx, line) in text.lines().enumerate() {
    if out.len() >= max_matches {
      return Ok(true);
    }
    if pattern.is_match(line) {
      let display_line = if line.len() > SEARCH_MAX_LINE_LEN {
        format!("{}…", &line[..SEARCH_MAX_LINE_LEN])
      } else {
        line.to_string()
      };
      out.push(WorkspaceSearchMatch {
        relative_path: relative_path.to_string(),
        line_number: (idx + 1) as u32,
        line_text: display_line,
      });
    }
  }
  Ok(false)
}

fn search_recursive(
  canon_root: &Path,
  dir: &Path,
  relative_prefix: &str,
  pattern: &regex::Regex,
  file_glob: Option<&str>,
  out: &mut Vec<WorkspaceSearchMatch>,
  max_matches: usize,
  files_searched: &mut u32,
) -> Result<bool, String> {
  if *files_searched as usize >= SEARCH_MAX_FILES || out.len() >= max_matches {
    return Ok(true);
  }
  let entries = match fs::read_dir(dir) {
    Ok(e) => e,
    Err(_) => return Ok(false),
  };
  for entry in entries {
    let entry = match entry {
      Ok(e) => e,
      Err(_) => continue,
    };
    let name = entry.file_name().to_string_lossy().to_string();
    if name == "." || name == ".." {
      continue;
    }
    let path = entry.path();
    let meta = match entry.metadata() {
      Ok(m) => m,
      Err(_) => continue,
    };
    if meta.is_dir() {
      if SKIP_WALK_DIR_NAMES.contains(&name.as_str()) {
        continue;
      }
      let next_prefix = if relative_prefix.is_empty() {
        name.clone()
      } else {
        format!("{relative_prefix}/{name}")
      };
      if search_recursive(
        canon_root, &path, &next_prefix, pattern, file_glob, out, max_matches, files_searched,
      )? {
        return Ok(true);
      }
    } else if meta.is_file() {
      if let Some(glob) = file_glob {
        if !matches_glob(&name, glob) {
          continue;
        }
      }
      let canon_file = match path.canonicalize() {
        Ok(c) => c,
        Err(_) => continue,
      };
      if !canon_file.starts_with(canon_root) {
        continue;
      }
      let rel_path = if relative_prefix.is_empty() {
        name.clone()
      } else {
        format!("{relative_prefix}/{name}")
      };
      let rel_path = rel_path.replace('\\', "/");
      *files_searched += 1;
      if *files_searched as usize >= SEARCH_MAX_FILES || out.len() >= max_matches {
        return Ok(true);
      }
      let _ = search_file(&path, &rel_path, pattern, out, max_matches);
      if out.len() >= max_matches {
        return Ok(true);
      }
    }
  }
  Ok(false)
}

/// Recursive text search under the workspace.
#[tauri::command]
pub fn workspace_search_text(
  app: AppHandle,
  workspace_id: String,
  query: String,
  file_glob: Option<String>,
  case_insensitive: Option<bool>,
  max_results: Option<usize>,
) -> Result<WorkspaceSearchResult, String> {
  let query = query.trim();
  if query.is_empty() {
    return Err("Search query cannot be empty.".to_string());
  }

  let conn = db::open_connection(&app).map_err(|e| e.to_string())?;
  let root = workspace_root_path(&conn, &workspace_id)?;
  let canon = root.canonicalize().map_err(|e| e.to_string())?;

  let case_i = case_insensitive.unwrap_or(false);
  let pattern_str = if case_i {
    format!("(?i){}", regex::escape(query))
  } else {
    regex::escape(query)
  };
  let pattern = regex::Regex::new(&pattern_str)
    .map_err(|e| format!("Invalid search pattern: {e}"))?;

  let max_matches = max_results.unwrap_or(100).min(SEARCH_MAX_MATCHES);
  let glob_ref = file_glob.as_deref().filter(|s| !s.trim().is_empty());
  let mut matches: Vec<WorkspaceSearchMatch> = Vec::new();
  let mut files_searched: u32 = 0;

  let truncated = search_recursive(
    &canon, &canon, "", &pattern, glob_ref, &mut matches, max_matches, &mut files_searched,
  )?;

  Ok(WorkspaceSearchResult {
    matches,
    truncated,
    files_searched,
  })
}
