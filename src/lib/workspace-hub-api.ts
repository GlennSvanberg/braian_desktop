import { invoke } from '@tauri-apps/api/core'

import type { WorkspaceHubSnapshot } from '@/lib/workspace-hub-types'
import { isTauri } from '@/lib/tauri-env'

export async function workspaceHubSnapshot(
  workspaceId: string,
): Promise<WorkspaceHubSnapshot> {
  if (!isTauri()) {
    return {
      dashboard: null,
      webappAppRoutes: [],
      recentFiles: [],
      insightItems: [],
    }
  }
  return invoke<WorkspaceHubSnapshot>('workspace_hub_snapshot', { workspaceId })
}

export async function workspaceHubRecentFileTouch(input: {
  workspaceId: string
  relativePath: string
  label?: string | null
}): Promise<void> {
  if (!isTauri()) return
  await invoke('workspace_hub_recent_file_touch', {
    workspaceId: input.workspaceId,
    relativePath: input.relativePath,
    label: input.label ?? null,
  })
}
