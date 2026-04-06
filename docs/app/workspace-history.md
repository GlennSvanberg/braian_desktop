# Workspace snapshots (Git checkpoints)

**Workspace snapshots** are an optional, per-workspace feature that keeps a **Git repository at the workspace folder root** and records **automatic checkpoints** when files under that folder change. You turn them on in **Workspace → Settings**, in the **Workspace snapshots** section.

Snapshots help you roll the whole workspace tree back to a recent point in time. They complement your own Git workflow (branches, remotes, code review) but are **not** a full replacement for team source control.

## Desktop only

Checkpointing and restore run through **Tauri commands** and **libgit2** (the `git2` Rust crate). They are unavailable in the **browser-only** dev shell (`npm run dev` without Tauri).

## How it is stored

- **Toggle and config:** `.braian/git-history.json` in the workspace root. It stores whether automatic checkpoints are **enabled** for that folder.
- **Repository:** A normal `.git` directory at the **workspace root** (created when you turn the feature on, if it does not already exist).
- **Default ignore rules:** When Braian initializes or updates ignore rules, it **merges** lines into the root `.gitignore` for common secrets and heavy folders (for example `.env`, `.env.*`, `*.pem`, `node_modules/`) without removing your existing rules.

Commits use the author identity `Braian <braian@local>`.

## What counts as a checkpoint

Only commits whose **first line** starts with `braian:` are listed as snapshots in the UI. That includes:

- **Automatic checkpoints** after idle time when the tree is dirty (see below).
- **`braian: pre-restore snapshot`** created before a restore if there were uncommitted changes.
- **Manual snapshot** from chat (see below).

Other commits in the same repo (your own `git commit`, merges, etc.) **do not appear** in the snapshot list, though they remain part of Git history.

## Automatic checkpoints

When snapshots are on, Braian **schedules** a checkpoint after durable workspace writes, with:

- **Debounce:** about **45 seconds** after the last qualifying activity.
- **Minimum gap:** at least about **90 seconds** between **successful** checkpoint commits for the same workspace (if a commit was skipped because the tree was clean, the timer is not advanced by that logic in the same way—see `src/lib/workspace/workspace-activity.ts`).

Activity that can schedule a checkpoint includes things that **persist files** under the workspace, such as conversation saves, canvas/file tools, and workspace file APIs—implemented via `emitWorkspaceDurableActivity` in the codebase.

If there is **nothing to commit** (clean tree), no new checkpoint is created.

## Manual snapshot from chat

In a **saved** workspace chat, you can trigger **Save workspace snapshot** (or equivalent control in the chat workbench). That attempts an immediate checkpoint with a `manual` suffix in the message when the tree is dirty and snapshots are enabled.

## Listing and restoring

- The settings panel shows **recent** snapshots (up to **10** in the UI). The backend walks history for up to **50** `braian:` commits from the current HEAD.
- **Restore** checks out the **entire working tree** to that commit (force checkout), then sets **detached HEAD** at that commit.
- **Safety:** If you had uncommitted changes, Braian commits them first as **`braian: pre-restore snapshot`**, then creates a branch named **`braian-recovery-<timestamp>`** pointing at your previous HEAD so you can recover the pre-restore state with an external Git client if needed.

After a restore, **reload or reopen** conversations so the UI matches files on disk.

## Developer reference

| Area | Location |
|------|----------|
| Rust commands (`workspace_git_*`) | `src-tauri/src/workspace_git.rs` |
| Frontend invoke helpers | `src/lib/workspace/git-history-api.ts` |
| Debounce / min interval | `src/lib/workspace/workspace-activity.ts` |
| Settings UI | `src/components/app/workspace-history-panel.tsx` |

## Not implemented yet

Remote push/pull, branch-aware UX inside the app, and conflict handling for remotes are not part of workspace snapshots today; use standard Git tooling for that. Longer-term ideas live in the repository’s `NOTES.md` (versioning / workspace history section).

## Related

- [Overview](/docs/overview)
- [Capabilities](/docs/capabilities)
