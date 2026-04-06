//! Per-workspace Git checkpoints at `root_path` (see `braian_store::workspace_root_path`).

use std::fs;
use std::path::{Path, PathBuf};

use git2::{build::CheckoutBuilder, Repository, Signature};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::braian_store::{ensure_braian_layout, workspace_root_path};
use crate::db;

const GIT_HISTORY_RELATIVE: &str = ".braian/git-history.json";
const CHECKPOINT_PREFIX: &str = "braian:";
const DEFAULT_GITIGNORE_LINES: &[&str] = &[
  "# Braian defaults (secrets & heavy deps)",
  ".env",
  ".env.*",
  "*.pem",
  "node_modules/",
];

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitHistoryConfig {
  #[serde(default)]
  enabled: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceGitStatusDto {
  pub enabled: bool,
  pub is_repo: bool,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub head_oid: Option<String>,
  pub dirty: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceGitCheckpointDto {
  pub oid: String,
  pub summary: String,
  pub time_ms: i64,
}

fn config_path(root: &Path) -> PathBuf {
  root.join(GIT_HISTORY_RELATIVE)
}

fn read_config(root: &Path) -> GitHistoryConfig {
  let p = config_path(root);
  let Ok(raw) = fs::read_to_string(&p) else {
    return GitHistoryConfig::default();
  };
  serde_json::from_str(&raw).unwrap_or_default()
}

fn write_config(root: &Path, cfg: &GitHistoryConfig) -> Result<(), String> {
  ensure_braian_layout(root)?;
  let p = config_path(root);
  let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
  fs::write(&p, format!("{json}\n")).map_err(|e| e.to_string())
}

fn git_dir(root: &Path) -> PathBuf {
  root.join(".git")
}

fn open_repo(root: &Path) -> Option<Repository> {
  Repository::open(root).ok()
}

fn repo_is_dirty(repo: &Repository) -> Result<bool, String> {
  let mut opts = git2::StatusOptions::new();
  opts.include_untracked(true).include_ignored(false);
  let statuses = repo
    .statuses(Some(&mut opts))
    .map_err(|e| e.to_string())?;
  Ok(!statuses.is_empty())
}

fn head_oid_string(repo: &Repository) -> Option<String> {
  repo.head().ok()?.target().map(|o| o.to_string())
}

/// Merge default ignore lines into root `.gitignore` without removing user rules.
fn ensure_root_gitignore(root: &Path) -> Result<(), String> {
  let path = root.join(".gitignore");
  let existing = fs::read_to_string(&path).unwrap_or_default();
  let mut to_add: Vec<&str> = Vec::new();
  for line in DEFAULT_GITIGNORE_LINES {
    if !existing.lines().any(|l| l.trim() == *line) {
      to_add.push(line);
    }
  }
  if to_add.is_empty() {
    return Ok(());
  }
  let mut out = existing;
  if !out.is_empty() && !out.ends_with('\n') {
    out.push('\n');
  }
  if !out.is_empty() && !out.ends_with("\n\n") {
    out.push('\n');
  }
  for line in to_add {
    out.push_str(line);
    out.push('\n');
  }
  fs::write(&path, out).map_err(|e| e.to_string())
}

fn init_repo_if_needed(root: &Path) -> Result<Repository, String> {
  if git_dir(root).exists() {
    return Repository::open(root).map_err(|e| e.to_string());
  }
  ensure_braian_layout(root)?;
  ensure_root_gitignore(root)?;
  Repository::init(root).map_err(|e| e.to_string())
}

fn signature() -> Result<Signature<'static>, String> {
  Signature::now("Braian", "braian@local").map_err(|e| e.to_string())
}

fn commit_all_if_dirty(repo: &Repository, message: &str) -> Result<Option<String>, String> {
  if !repo_is_dirty(repo)? {
    return Ok(None);
  }
  let sig = signature()?;
  let mut index = repo.index().map_err(|e| e.to_string())?;
  index
    .add_all(["*"], git2::IndexAddOption::DEFAULT, None)
    .map_err(|e| e.to_string())?;
  index.write().map_err(|e| e.to_string())?;
  let tree_id = index.write_tree().map_err(|e| e.to_string())?;
  let tree = repo.find_tree(tree_id).map_err(|e| e.to_string())?;

  let parents: Vec<git2::Commit> = if let Ok(head) = repo.head() {
    head
      .peel_to_commit()
      .ok()
      .into_iter()
      .collect()
  } else {
    vec![]
  };

  let parent_refs: Vec<&git2::Commit> = parents.iter().collect();
  let oid = repo
    .commit(
      Some("HEAD"),
      &sig,
      &sig,
      message,
      &tree,
      &parent_refs,
    )
    .map_err(|e| e.to_string())?;
  Ok(Some(oid.to_string()))
}

#[tauri::command]
pub fn workspace_git_status(app: AppHandle, workspace_id: String) -> Result<WorkspaceGitStatusDto, String> {
  let conn = db::open_connection(&app).map_err(|e| e.to_string())?;
  let root = workspace_root_path(&conn, &workspace_id)?;
  let cfg = read_config(&root);
  let repo_opt = open_repo(&root);
  let is_repo = repo_opt.is_some();
  let (head_oid, dirty) = match &repo_opt {
    Some(repo) => (head_oid_string(repo), repo_is_dirty(repo).unwrap_or(true)),
    None => (None, false),
  };
  Ok(WorkspaceGitStatusDto {
    enabled: cfg.enabled,
    is_repo,
    head_oid,
    dirty,
  })
}

#[tauri::command]
pub fn workspace_git_set_enabled(
  app: AppHandle,
  workspace_id: String,
  enabled: bool,
) -> Result<(), String> {
  let conn = db::open_connection(&app).map_err(|e| e.to_string())?;
  let root = workspace_root_path(&conn, &workspace_id)?;
  write_config(&root, &GitHistoryConfig { enabled })?;
  Ok(())
}

/// Initialize repo and gitignore when history is enabled (no-op if `.git` exists).
#[tauri::command]
pub fn workspace_git_ensure(app: AppHandle, workspace_id: String) -> Result<(), String> {
  let conn = db::open_connection(&app).map_err(|e| e.to_string())?;
  let root = workspace_root_path(&conn, &workspace_id)?;
  let cfg = read_config(&root);
  if !cfg.enabled {
    return Ok(());
  }
  let _repo = init_repo_if_needed(&root)?;
  ensure_root_gitignore(&root)?;
  Ok(())
}

#[tauri::command]
pub fn workspace_git_list_checkpoints(
  app: AppHandle,
  workspace_id: String,
) -> Result<Vec<WorkspaceGitCheckpointDto>, String> {
  let conn = db::open_connection(&app).map_err(|e| e.to_string())?;
  let root = workspace_root_path(&conn, &workspace_id)?;
  let Some(repo) = open_repo(&root) else {
    return Ok(vec![]);
  };

  let mut revwalk = repo.revwalk().map_err(|e| e.to_string())?;
  // Fresh `git init`: HEAD points at refs/heads/master (or main) with no commits yet.
  // `revwalk.push_head()` then fails with "reference 'refs/heads/master' not found".
  let head = match repo.head() {
    Ok(h) => h,
    Err(_) => return Ok(vec![]),
  };
  let tip = match head.resolve() {
    Ok(r) => r,
    Err(_) => return Ok(vec![]),
  };
  let Some(oid) = tip.target() else {
    return Ok(vec![]);
  };
  revwalk.push(oid).map_err(|e| e.to_string())?;
  let mut out = Vec::new();
  for oid_res in revwalk {
    let oid = oid_res.map_err(|e| e.to_string())?;
    let Ok(commit) = repo.find_commit(oid) else {
      continue;
    };
    let msg = commit.message().unwrap_or("").trim();
    if !msg.starts_with(CHECKPOINT_PREFIX) {
      continue;
    }
    let summary = msg
      .lines()
      .next()
      .unwrap_or(msg)
      .trim()
      .to_string();
    let time_ms = commit.time().seconds() * 1000;
    out.push(WorkspaceGitCheckpointDto {
      oid: oid.to_string(),
      summary,
      time_ms,
    });
    if out.len() >= 50 {
      break;
    }
  }
  Ok(out)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceGitTryCommitInput {
  pub workspace_id: String,
  #[serde(default)]
  pub message_suffix: Option<String>,
}

#[tauri::command]
pub fn workspace_git_try_commit(
  app: AppHandle,
  input: WorkspaceGitTryCommitInput,
) -> Result<Option<String>, String> {
  let conn = db::open_connection(&app).map_err(|e| e.to_string())?;
  let root = workspace_root_path(&conn, &input.workspace_id)?;
  let cfg = read_config(&root);
  if !cfg.enabled {
    return Ok(None);
  }

  let repo = init_repo_if_needed(&root)?;
  ensure_root_gitignore(&root)?;

  let ts = checkpoint_timestamp_ms();
  let msg = match &input.message_suffix {
    Some(s) if !s.trim().is_empty() => {
      format!("{CHECKPOINT_PREFIX} checkpoint {ts} — {}", s.trim())
    }
    _ => format!("{CHECKPOINT_PREFIX} checkpoint {ts}"),
  };

  commit_all_if_dirty(&repo, &msg)
}

fn checkpoint_timestamp_ms() -> String {
  use std::time::{SystemTime, UNIX_EPOCH};
  let ms = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|d| d.as_millis())
    .unwrap_or(0);
  format!("{ms}")
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceGitRestoreFullInput {
  pub workspace_id: String,
  pub target_oid: String,
}

#[tauri::command]
pub fn workspace_git_restore_full(
  app: AppHandle,
  input: WorkspaceGitRestoreFullInput,
) -> Result<String, String> {
  let conn = db::open_connection(&app).map_err(|e| e.to_string())?;
  let root = workspace_root_path(&conn, &input.workspace_id)?;
  let cfg = read_config(&root);
  if !cfg.enabled {
    return Err("Workspace history is disabled.".to_string());
  }
  let repo = open_repo(&root).ok_or("No Git repository in this workspace.")?;

  let target = git2::Oid::from_str(&input.target_oid).map_err(|e| e.to_string())?;
  let _target_commit = repo
    .find_commit(target)
    .map_err(|_| "Checkpoint not found.".to_string())?;

  // Snapshot current state: commit WIP if dirty, then create recovery branch.
  if repo_is_dirty(&repo)? {
    commit_all_if_dirty(
      &repo,
      &format!("{CHECKPOINT_PREFIX} pre-restore snapshot"),
    )?;
  }

  let head_oid = repo
    .head()
    .ok()
    .and_then(|h| h.target().map(|o| o.to_string()))
    .unwrap_or_else(|| "initial".to_string());
  let branch_name = format!(
    "braian-recovery-{}",
    std::time::SystemTime::now()
      .duration_since(std::time::UNIX_EPOCH)
      .map(|d| d.as_millis())
      .unwrap_or(0)
  );
  let head_ref = repo.head().map_err(|e| e.to_string())?;
  let head_commit = head_ref.peel_to_commit().map_err(|e| e.to_string())?;
  repo
    .branch(&branch_name, &head_commit, false)
    .map_err(|e| e.to_string())?;

  let obj = repo
    .revparse_single(&input.target_oid)
    .map_err(|e| e.to_string())?;
  let commit = obj.into_commit().map_err(|_| "Target is not a commit.".to_string())?;
  let tree = commit.tree().map_err(|e| e.to_string())?;

  let mut checkout = CheckoutBuilder::default();
  checkout.force();
  repo
    .checkout_tree(tree.as_object(), Some(&mut checkout))
    .map_err(|e| e.to_string())?;

  repo
    .set_head_detached(target)
    .map_err(|e| e.to_string())?;

  Ok(format!(
    "Restored workspace to {}. Recovery branch: {} (previous HEAD: {}).",
    input.target_oid, branch_name, head_oid
  ))
}

#[cfg(test)]
mod tests {
  use super::*;

  fn write_file(root: &Path, rel: &str, body: &str) {
    let p = root.join(rel);
    if let Some(parent) = p.parent() {
      fs::create_dir_all(parent).unwrap();
    }
    fs::write(&p, body).unwrap();
  }

  #[test]
  fn init_commit_restore_roundtrip() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    ensure_braian_layout(root).unwrap();
    write_config(root, &GitHistoryConfig { enabled: true }).unwrap();

    let repo = init_repo_if_needed(root).unwrap();
    write_file(root, "foo.txt", "v1");
    let oid1 = commit_all_if_dirty(&repo, "braian: checkpoint test1")
      .unwrap()
      .expect("commit");

    // Refresh repo (index may be stale in memory)
    drop(repo);
    let repo = Repository::open(root).unwrap();
    write_file(root, "foo.txt", "v2");
    let _oid2 = commit_all_if_dirty(&repo, "braian: checkpoint test2")
      .unwrap()
      .expect("commit2");

    assert_eq!(fs::read_to_string(root.join("foo.txt")).unwrap(), "v2");

    drop(repo);
    let repo = Repository::open(root).unwrap();
    // Restore to first commit's tree: same as workspace_git_restore_full logic simplified
    let commit = repo.find_commit(git2::Oid::from_str(&oid1).unwrap()).unwrap();
    let tree = commit.tree().unwrap();
    let mut checkout = CheckoutBuilder::default();
    checkout.force();
    repo
      .checkout_tree(tree.as_object(), Some(&mut checkout))
      .unwrap();
    repo.set_head_detached(commit.id()).unwrap();

    assert_eq!(fs::read_to_string(root.join("foo.txt")).unwrap(), "v1");
  }
}
