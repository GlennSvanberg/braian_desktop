import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'

import {
  MOCK_WORKSPACES,
  getConversationById,
  getConversationsForWorkspace,
  mockConversationDelete,
  mockConversationSetPinned,
  mockConversationSetTitle,
  mockConversationSetUnread,
} from '@/lib/mock-workspace-data'
import type { ChatThreadState } from '@/lib/chat-sessions/types'
import type { WorkspaceArtifactPayload } from '@/lib/artifacts/types'
import { isTauri } from '@/lib/tauri-env'

export type WorkspaceDto = {
  id: string
  name: string
  rootPath: string
  createdAtMs: number
  lastUsedAtMs: number
}

export type ConversationDto = {
  id: string
  workspaceId: string
  title: string
  updatedAtMs: number
  canvasKind: string
  pinned: boolean
  unread: boolean
}

export async function workspaceList(): Promise<WorkspaceDto[]> {
  if (!isTauri()) {
    return MOCK_WORKSPACES.map((w, i) => ({
      id: w.id,
      name: w.name,
      rootPath: '',
      createdAtMs: 0,
      lastUsedAtMs: (MOCK_WORKSPACES.length - i) * 1000,
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

export async function workspaceTouch(id: string): Promise<void> {
  if (!isTauri()) return
  await invoke('workspace_touch', { id })
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
    const rows = getConversationsForWorkspace(workspaceId).map((c, i) => ({
      id: c.id,
      workspaceId: c.workspaceId,
      title: c.title,
      updatedAtMs: now - i * 60_000,
      canvasKind: c.canvasKind,
      pinned: c.pinned ?? false,
      unread: c.unread ?? false,
    }))
    return rows.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return b.updatedAtMs - a.updatedAtMs
    })
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

export async function conversationSetTitle(input: {
  id: string
  workspaceId: string
  title: string
}): Promise<void> {
  if (!isTauri()) {
    mockConversationSetTitle(input.id, input.title)
    return
  }
  await invoke('conversation_set_title', {
    input: {
      id: input.id,
      workspaceId: input.workspaceId,
      title: input.title,
    },
  })
}

export async function conversationSetPinned(input: {
  id: string
  workspaceId: string
  pinned: boolean
}): Promise<void> {
  if (!isTauri()) {
    mockConversationSetPinned(input.id, input.pinned)
    return
  }
  await invoke('conversation_set_pinned', {
    input: {
      id: input.id,
      workspaceId: input.workspaceId,
      pinned: input.pinned,
    },
  })
}

export async function conversationSetUnread(input: {
  id: string
  workspaceId: string
  unread: boolean
}): Promise<void> {
  if (!isTauri()) {
    mockConversationSetUnread(input.id, input.unread)
    return
  }
  await invoke('conversation_set_unread', {
    input: {
      id: input.id,
      workspaceId: input.workspaceId,
      unread: input.unread,
    },
  })
}

export async function conversationDelete(input: {
  id: string
  workspaceId: string
}): Promise<void> {
  if (!isTauri()) {
    mockConversationDelete(input.id)
    return
  }
  await invoke('conversation_delete', {
    input: {
      id: input.id,
      workspaceId: input.workspaceId,
    },
  })
}

export type ContextFileEntryDto = {
  relativePath: string
  displayName?: string
  addedAtMs?: number
}

export type AgentMode = 'document' | 'code'

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
  contextFiles: ContextFileEntryDto[]
  agentMode: AgentMode
  appHarnessEnabled: boolean
  pinned: boolean
  unread: boolean
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
    contextFiles?: ContextFileEntryDto[]
    agentMode?: string
    appHarnessEnabled?: boolean
  }
}

function normalizeAgentMode(raw: string | undefined): AgentMode {
  return raw === 'code' ? 'code' : 'document'
}

function normalizeAppHarnessEnabled(raw: boolean | undefined): boolean {
  return raw === true
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
      const role = m.role as 'user' | 'assistant'
      if (role === 'user') {
        return { id: m.id, role: 'user' as const, content: m.content }
      }
      return {
        id: m.id,
        role: 'assistant' as const,
        content: m.content,
        ...(status ? { status } : {}),
      }
    }),
    artifactOpen: thread.artifactOpen,
    artifactPayload: (thread.artifactPayload ?? null) as WorkspaceArtifactPayload | null,
    draft: thread.draft,
    generating: thread.generating,
    pendingUserMessages: [],
    contextFiles: thread.contextFiles ?? [],
    agentMode: normalizeAgentMode(thread.agentMode),
    appHarnessEnabled: normalizeAppHarnessEnabled(thread.appHarnessEnabled),
    lastModelRequestSnapshot: null,
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
      pinned: c.pinned ?? false,
      unread: c.unread ?? false,
    }
    if (c.demoMessages?.length) {
      const { getMockArtifactPayloadForChat } = await import('@/lib/artifacts')
      const thread: ChatThreadState = {
        messages: c.demoMessages.map((m, i) => {
          if (m.role === 'user') {
            return {
              id: `seed-${c.id}-${i}`,
              role: 'user' as const,
              content: m.content,
            }
          }
          return {
            id: `seed-${c.id}-${i}`,
            role: 'assistant' as const,
            content: m.content,
            status: 'complete' as const,
          }
        }),
        artifactOpen: false,
        artifactPayload: getMockArtifactPayloadForChat(c.id, {
          title: c.title,
          canvasKind: c.canvasKind,
        }),
        draft: '',
        generating: false,
        pendingUserMessages: [],
        contextFiles: [],
        agentMode: 'document',
        appHarnessEnabled: false,
        lastModelRequestSnapshot: null,
      }
      return { conversation, thread }
    }
    const thread: ChatThreadState = {
      messages: [],
      artifactOpen: false,
      artifactPayload: null,
      draft: '',
      generating: false,
      pendingUserMessages: [],
      contextFiles: [],
      agentMode: 'document',
      appHarnessEnabled: false,
      lastModelRequestSnapshot: null,
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
  conversation: Pick<
    ConversationDto,
    'id' | 'workspaceId' | 'title' | 'canvasKind' | 'pinned' | 'unread'
  >,
): ConversationSavePayload {
  const canvasKind = thread.artifactPayload?.kind ?? conversation.canvasKind
  return {
    id: conversation.id,
    workspaceId: conversation.workspaceId,
    title: conversation.title,
    canvasKind,
    pinned: conversation.pinned ?? false,
    unread: conversation.unread ?? false,
    artifactOpen: thread.artifactOpen,
    draft: thread.draft,
    messages: thread.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      status:
        m.role === 'assistant'
          ? m.status === 'streaming'
            ? 'complete'
            : m.status
          : undefined,
    })),
    artifactPayload: thread.artifactPayload,
    contextFiles: thread.contextFiles.map((f) => ({
      relativePath: f.relativePath,
      ...(f.displayName != null && f.displayName !== ''
        ? { displayName: f.displayName }
        : {}),
      ...(f.addedAtMs != null ? { addedAtMs: f.addedAtMs } : {}),
    })),
    agentMode: thread.agentMode ?? 'document',
    appHarnessEnabled: thread.appHarnessEnabled ?? false,
  }
}

export type WorkspaceReadTextFileResult = {
  text: string
  truncated: boolean
}

export async function workspaceReadTextFile(
  workspaceId: string,
  relativePath: string,
  maxBytes?: number | null,
): Promise<WorkspaceReadTextFileResult> {
  if (!isTauri()) {
    throw new Error('Reading workspace files requires the desktop app.')
  }
  return invoke<WorkspaceReadTextFileResult>('workspace_read_text_file', {
    workspaceId,
    relativePath,
    maxBytes: maxBytes ?? null,
  })
}

export async function workspaceWriteTextFile(
  workspaceId: string,
  relativePath: string,
  content: string,
): Promise<void> {
  if (!isTauri()) {
    throw new Error('Writing workspace files requires the desktop app.')
  }
  await invoke('workspace_write_text_file', {
    workspaceId,
    relativePath,
    content,
  })
}

export type WorkspaceRunCommandResult = {
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

export async function workspaceRunCommand(input: {
  workspaceId: string
  program: string
  args: string[]
  cwd?: string | null
  timeoutMs?: number | null
  maxOutputBytes?: number | null
}): Promise<WorkspaceRunCommandResult> {
  if (!isTauri()) {
    throw new Error('Running commands requires the desktop app.')
  }
  return invoke<WorkspaceRunCommandResult>('workspace_run_command', {
    workspaceId: input.workspaceId,
    program: input.program,
    args: input.args,
    cwd: input.cwd ?? null,
    timeoutMs: input.timeoutMs ?? null,
    maxOutputBytes: input.maxOutputBytes ?? null,
  })
}

export type WorkspaceImportFileResult = {
  relativePath: string
  displayName: string
}

export async function workspaceImportFile(
  workspaceId: string,
  sourcePath: string,
): Promise<WorkspaceImportFileResult> {
  if (!isTauri()) {
    throw new Error('Importing files requires the desktop app.')
  }
  return invoke<WorkspaceImportFileResult>('workspace_import_file', {
    workspaceId,
    sourcePath,
  })
}

export type WorkspaceDirEntryDto = {
  name: string
  relativePath: string
  isDir: boolean
}

export async function workspaceListDir(
  workspaceId: string,
  relativeDir: string,
): Promise<WorkspaceDirEntryDto[]> {
  if (!isTauri()) return []
  return invoke<WorkspaceDirEntryDto[]>('workspace_list_dir', {
    workspaceId,
    relativeDir,
  })
}

export type WorkspaceFileIndexEntry = {
  relativePath: string
  name: string
}

/** Recursive file index for @ mentions (excludes node_modules, .git, etc.). */
export async function workspaceListAllFiles(
  workspaceId: string,
): Promise<WorkspaceFileIndexEntry[]> {
  if (!isTauri()) return []
  return invoke<WorkspaceFileIndexEntry[]>('workspace_list_all_files', {
    workspaceId,
  })
}
