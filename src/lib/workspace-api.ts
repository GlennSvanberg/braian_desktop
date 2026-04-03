import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'

import {
  MOCK_WORKSPACES,
  getConversationById,
  getConversationsForWorkspace,
} from '@/lib/mock-workspace-data'
import type { ChatThreadState } from '@/lib/chat-sessions/types'
import type { WorkspaceArtifactPayload } from '@/lib/artifacts/types'
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

export type ConversationSavePayload = {
  id: string
  workspaceId: string
  title: string
  canvasKind: string
  artifactOpen: boolean
  draft: string
  messages: Array<{
    id: string
    role: string
    content: string
    status?: string
  }>
  artifactPayload: WorkspaceArtifactPayload | null
}

export type ConversationOpenResult = {
  conversation: ConversationDto
  thread: ChatThreadState
}

type ConversationOpenInvoke = {
  conversation: ConversationDto
  thread: {
    messages: Array<{
      id: string
      role: string
      content: string
      status?: string
    }>
    artifactOpen: boolean
    artifactPayload: unknown
    draft: string
    generating: boolean
  }
}

function mapInvokeThreadToState(
  thread: ConversationOpenInvoke['thread'],
): ChatThreadState {
  return {
    messages: thread.messages.map((m) => {
      const status =
        m.status === 'streaming' || m.status === 'complete'
          ? m.status
          : undefined
      return {
        id: m.id,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        ...(status ? { status } : {}),
      }
    }),
    artifactOpen: thread.artifactOpen,
    artifactPayload: (thread.artifactPayload ?? null) as WorkspaceArtifactPayload | null,
    draft: thread.draft,
    generating: thread.generating,
  }
}

/** Load conversation meta + thread from `.braian` (desktop) or mock data (browser). */
export async function conversationOpen(
  id: string,
): Promise<ConversationOpenResult | null> {
  if (!isTauri()) {
    const c = getConversationById(id)
    if (!c) return null
    const conversation: ConversationDto = {
      id: c.id,
      workspaceId: c.workspaceId,
      title: c.title,
      updatedAtMs: Date.now(),
      canvasKind: c.canvasKind,
    }
    if (c.demoMessages?.length) {
      const { getMockArtifactPayloadForChat } = await import('@/lib/artifacts')
      const thread: ChatThreadState = {
        messages: c.demoMessages.map((m, i) => ({
          id: `seed-${c.id}-${i}`,
          role: m.role,
          content: m.content,
          status: 'complete' as const,
        })),
        artifactOpen: true,
        artifactPayload: getMockArtifactPayloadForChat(c.id, {
          title: c.title,
          canvasKind: c.canvasKind,
        }),
        draft: '',
        generating: false,
      }
      return { conversation, thread }
    }
    const thread: ChatThreadState = {
      messages: [],
      artifactOpen: false,
      artifactPayload: null,
      draft: '',
      generating: false,
    }
    return { conversation, thread }
  }
  const raw = await invoke<ConversationOpenInvoke | null>('conversation_open', {
    id,
  })
  if (!raw) return null
  return {
    conversation: raw.conversation,
    thread: mapInvokeThreadToState(raw.thread),
  }
}

export async function conversationSave(input: ConversationSavePayload): Promise<void> {
  if (!isTauri()) return
  await invoke('conversation_save', { input })
}

/** Snapshot for persisting; normalizes streaming messages to complete for disk. */
export function buildConversationSavePayload(
  thread: ChatThreadState,
  conversation: Pick<ConversationDto, 'id' | 'workspaceId' | 'title' | 'canvasKind'>,
): ConversationSavePayload {
  const canvasKind = thread.artifactPayload?.kind ?? conversation.canvasKind
  return {
    id: conversation.id,
    workspaceId: conversation.workspaceId,
    title: conversation.title,
    canvasKind,
    artifactOpen: thread.artifactOpen,
    draft: thread.draft,
    messages: thread.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      status:
        m.status === 'streaming' ? 'complete' : m.status,
    })),
    artifactPayload: thread.artifactPayload,
  }
}
