import { invoke } from '@tauri-apps/api/core'

import { isTauri } from '@/lib/tauri-env'

export type WorkspaceGitStatus = {
  enabled: boolean
  isRepo: boolean
  headOid?: string
  dirty: boolean
}

export type WorkspaceGitCheckpoint = {
  oid: string
  summary: string
  timeMs: number
}

export async function workspaceGitStatus(
  workspaceId: string,
): Promise<WorkspaceGitStatus | null> {
  if (!isTauri()) return null
  return invoke<WorkspaceGitStatus>('workspace_git_status', { workspaceId })
}

export async function workspaceGitSetEnabled(
  workspaceId: string,
  enabled: boolean,
): Promise<void> {
  if (!isTauri()) return
  await invoke('workspace_git_set_enabled', { workspaceId, enabled })
}

export async function workspaceGitEnsure(workspaceId: string): Promise<void> {
  if (!isTauri()) return
  await invoke('workspace_git_ensure', { workspaceId })
}

export async function workspaceGitListCheckpoints(
  workspaceId: string,
): Promise<WorkspaceGitCheckpoint[]> {
  if (!isTauri()) return []
  return invoke<WorkspaceGitCheckpoint[]>('workspace_git_list_checkpoints', {
    workspaceId,
  })
}

/** Returns new commit oid if a checkpoint was created; null if skipped or clean. */
export async function workspaceGitTryCommit(
  workspaceId: string,
  messageSuffix?: string,
): Promise<string | null> {
  if (!isTauri()) return null
  return invoke<string | null>('workspace_git_try_commit', {
    input: {
      workspaceId,
      ...(messageSuffix != null && messageSuffix !== ''
        ? { messageSuffix }
        : {}),
    },
  })
}

export async function workspaceGitRestoreFull(
  workspaceId: string,
  targetOid: string,
): Promise<string> {
  if (!isTauri()) {
    throw new Error('Restore requires the desktop app.')
  }
  return invoke<string>('workspace_git_restore_full', {
    input: { workspaceId, targetOid },
  })
}
