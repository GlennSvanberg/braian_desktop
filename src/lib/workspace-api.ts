import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'

import {
  MOCK_WORKSPACES,
  getConversationById,
  getConversationsForWorkspace,
} from '@/lib/mock-workspace-data'
import { isTauri } from '@/lib/tauri-env'

export type WorkspaceDto = {
  id: string
  name: string
  rootPath: string
  createdAtMs: number
}

export type ConversationDto = {
  id: string
  workspaceId: string
  title: string
  updatedAtMs: number
  canvasKind: string
}

export async function workspaceList(): Promise<WorkspaceDto[]> {
  if (!isTauri()) {
    return MOCK_WORKSPACES.map((w) => ({
      id: w.id,
      name: w.name,
      rootPath: '',
      createdAtMs: 0,
    }))
  }
  return invoke<WorkspaceDto[]>('workspace_list')
}

export async function workspaceGetDefaultRoot(): Promise<string | null> {
  if (!isTauri()) return null
  try {
    return await invoke<string>('workspace_get_default_root')
  } catch {
    return null
  }
}

export async function workspaceCreate(
  parentPath: string,
  name: string,
): Promise<WorkspaceDto> {
  if (!isTauri()) {
    throw new Error('Creating workspaces requires the desktop app.')
  }
  return invoke<WorkspaceDto>('workspace_create', { parentPath, name })
}

export async function workspaceAddFromPath(
  path: string,
  displayName?: string,
): Promise<WorkspaceDto> {
  if (!isTauri()) {
    throw new Error('Adding a folder requires the desktop app.')
  }
  return invoke<WorkspaceDto>('workspace_add_from_path', {
    path,
    displayName: displayName ?? null,
  })
}

export async function workspaceRemove(id: string): Promise<void> {
  if (!isTauri()) return
  await invoke('workspace_remove', { id })
}

export async function workspaceRename(id: string, name: string): Promise<void> {
  if (!isTauri()) return
  await invoke('workspace_rename', { id, name })
}

export async function pickFolder(options?: {
  title?: string
  defaultPath?: string
}): Promise<string | null> {
  if (!isTauri()) return null
  return open({
    directory: true,
    multiple: false,
    title: options?.title ?? 'Choose workspace folder',
    defaultPath: options?.defaultPath,
  })
}

export async function conversationList(
  workspaceId: string,
): Promise<ConversationDto[]> {
  if (!isTauri()) {
    const now = Date.now()
    return getConversationsForWorkspace(workspaceId).map((c, i) => ({
      id: c.id,
      workspaceId: c.workspaceId,
      title: c.title,
      updatedAtMs: now - i * 60_000,
      canvasKind: c.canvasKind,
    }))
  }
  return invoke<ConversationDto[]>('conversation_list', { workspaceId })
}

export async function conversationCreate(
  workspaceId: string,
): Promise<ConversationDto> {
  if (!isTauri()) {
    throw new Error('Saving chats to a workspace requires the desktop app.')
  }
  return invoke<ConversationDto>('conversation_create', { workspaceId })
}

export async function conversationGet(
  id: string,
): Promise<ConversationDto | null> {
  if (!isTauri()) {
    const c = getConversationById(id)
    if (!c) return null
    return {
      id: c.id,
      workspaceId: c.workspaceId,
      title: c.title,
      updatedAtMs: Date.now(),
      canvasKind: c.canvasKind,
    }
  }
  return invoke<ConversationDto | null>('conversation_get', { id })
}
