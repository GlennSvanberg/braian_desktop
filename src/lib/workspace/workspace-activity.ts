/**
 * Coordinates background reactions to durable workspace changes: automatic Git
 * checkpoints (debounced) and optional memory auto-review (after chat turns).
 */

import { isTauri } from '@/lib/tauri-env'

/** Wait this long after the last mutation before attempting a checkpoint. */
export const GIT_CHECKPOINT_DEBOUNCE_MS = 45_000

/** Minimum time between successful checkpoint commits per workspace. */
export const GIT_CHECKPOINT_MIN_INTERVAL_MS = 90_000

const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()
const lastSuccessfulCommitMs = new Map<string, number>()

function runGitCheckpointFlush(workspaceId: string): void {
  debounceTimers.delete(workspaceId)

  const last = lastSuccessfulCommitMs.get(workspaceId) ?? 0
  const now = Date.now()
  if (
    last > 0 &&
    now - last < GIT_CHECKPOINT_MIN_INTERVAL_MS
  ) {
    const wait = GIT_CHECKPOINT_MIN_INTERVAL_MS - (now - last)
    debounceTimers.set(
      workspaceId,
      setTimeout(() => {
        runGitCheckpointFlush(workspaceId)
      }, wait),
    )
    return
  }

  void import('@/lib/workspace/git-history-api')
    .then(({ workspaceGitTryCommit }) => workspaceGitTryCommit(workspaceId))
    .then((oid) => {
      if (oid != null) {
        lastSuccessfulCommitMs.set(workspaceId, Date.now())
      }
    })
    .catch((e) => {
      console.warn('[braian] workspace_git_try_commit', e)
    })
}

function scheduleGitCheckpointDebounced(workspaceId: string): void {
  if (!isTauri()) return

  const existing = debounceTimers.get(workspaceId)
  if (existing) clearTimeout(existing)

  debounceTimers.set(
    workspaceId,
    setTimeout(() => {
      runGitCheckpointFlush(workspaceId)
    }, GIT_CHECKPOINT_DEBOUNCE_MS),
  )
}

/**
 * Call when durable workspace content changed on disk.
 *
 * - Always schedules a debounced Git checkpoint (desktop only).
 * - When `conversationId` is set (completed assistant turn), also triggers the
 *   existing memory auto-review scheduler. Omit `conversationId` for saves that
 *   should not reset the memory idle debounce (e.g. frequent conversation autosave).
 */
export function emitWorkspaceDurableActivity(
  workspaceId: string,
  options?: { conversationId?: string },
): void {
  if (!isTauri()) return

  if (options?.conversationId) {
    void import('@/lib/memory/scheduler').then((m) =>
      m.scheduleMemoryReviewAfterIdle(
        workspaceId,
        options.conversationId!,
      ),
    )
  }

  scheduleGitCheckpointDebounced(workspaceId)
}
