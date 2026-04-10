import { useCallback, useSyncExternalStore } from 'react'

import { streamChatTurn } from '@/lib/ai'
import {
  buildTanStackChatTurnArgs,
  tanStackTurnArgsToSnapshot,
} from '@/lib/ai/chat-turn-args'
import { resolveChatHistoryForModelTurn } from '@/lib/conversation/working-memory'
import { formatCanvasSelectionUserMessage } from '@/lib/ai/canvas-selection-message'
import { getDocumentCanvasLivePayload } from '@/lib/ai/document-canvas-live'
import { getWorkspaceFileCanvasLivePayload } from '@/lib/ai/workspace-file-canvas-live'
import type {
  ChatStreamChunk,
  DocumentCanvasSelectionContext,
} from '@/lib/ai/types'
import { loadContextConversationsForModel } from '@/lib/context-conversations-for-ai'
import { loadContextFilesForModel } from '@/lib/context-files-for-ai'
import { getMockArtifactPayloadForChat } from '@/lib/artifacts'
import { getConversationById } from '@/lib/mock-workspace-data'
import {
  cancelWorkspaceMcpIdleDisconnect,
  scheduleWorkspaceMcpIdleDisconnect,
} from '@/lib/mcp-runtime-api'
import { isTauri } from '@/lib/tauri-env'
import {
  deriveAgentModeFromPersisted,
  workspaceReadTextFile,
  type AgentMode,
} from '@/lib/workspace-api'

import {
  isNonWorkspaceScopedSessionId,
  isUserProfileSessionId,
  USER_PROFILE_WORKSPACE_SESSION_ID,
} from '@/lib/chat-sessions/detached'

import { chatSessionKey, parseChatSessionKey } from './keys'
import {
  DEFAULT_CHAT_THREAD,
  type AssistantPart,
  type AssistantChatMessage,
  type ChatMessage,
  type ChatThreadState,
  type ContextConversationEntry,
  type ContextFileEntry,
  type PendingUserTurn,
} from './types'

import { chatMessageContentForLlmHistory } from './chat-message-llm-history'

export { chatMessageContentForLlmHistory }

const PROFILE_THREAD_LS_KEY = 'braian.io.userProfileChatThread.v1'

/** Stable session key for sidebar → You (profile coach chat). */
export const PROFILE_CHAT_SESSION_KEY = chatSessionKey(
  USER_PROFILE_WORKSPACE_SESSION_ID,
  null,
)

let profileThreadHydrated = false
let profileThreadSaveTimer: ReturnType<typeof setTimeout> | null = null

function hydrateUserProfileThreadOnce() {
  if (profileThreadHydrated) return
  profileThreadHydrated = true
  if (typeof localStorage === 'undefined') return
  try {
    const raw = localStorage.getItem(PROFILE_THREAD_LS_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as Partial<ChatThreadState>
    const messages = Array.isArray(parsed.messages)
      ? (parsed.messages as ChatMessage[])
      : []
    const merged: ChatThreadState = {
      ...DEFAULT_CHAT_THREAD,
      messages,
      draft: typeof parsed.draft === 'string' ? parsed.draft : '',
      agentMode:
        parsed.agentMode === 'code'
          ? 'code'
          : parsed.agentMode === 'app'
            ? 'app'
            : 'document',
      reasoningMode:
        (parsed as { reasoningMode?: string }).reasoningMode === 'thinking'
          ? 'thinking'
          : 'fast',
      activeMcpServers: Array.isArray(
        (parsed as { activeMcpServers?: unknown }).activeMcpServers,
      )
        ? ((parsed as { activeMcpServers?: unknown[] }).activeMcpServers ?? [])
            .filter((s): s is string => typeof s === 'string')
            .map((s) => s.trim())
            .filter((s) => s.length > 0)
        : [],
      contextFiles: [],
      contextConversations: [],
      artifactOpen: false,
      artifactPayload: null,
      generating: false,
      pendingUserMessages: [],
      lastModelRequestSnapshot: null,
    }
    threads = { ...threads, [PROFILE_CHAT_SESSION_KEY]: merged }
  } catch (e) {
    console.error('[braian] profile chat hydrate', e)
  }
}

function ensureProfileThreadHydrated(sessionKey: string) {
  if (sessionKey !== PROFILE_CHAT_SESSION_KEY) return
  hydrateUserProfileThreadOnce()
}

function scheduleProfileThreadPersist() {
  if (typeof localStorage === 'undefined') return
  if (profileThreadSaveTimer) clearTimeout(profileThreadSaveTimer)
  profileThreadSaveTimer = setTimeout(() => {
    profileThreadSaveTimer = null
    const t = threads[PROFILE_CHAT_SESSION_KEY]
    if (!t) return
    try {
      const payload = {
        messages: t.messages,
        draft: t.draft,
        agentMode: t.agentMode,
        reasoningMode: t.reasoningMode,
        activeMcpServers: t.activeMcpServers,
      }
      localStorage.setItem(PROFILE_THREAD_LS_KEY, JSON.stringify(payload))
    } catch (e) {
      console.error('[braian] profile chat persist', e)
    }
  }, 400)
}

function createId() {
  return `m-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function isChatPerfLoggingEnabled(): boolean {
  if (typeof localStorage === 'undefined') return false
  try {
    return localStorage.getItem('braian.chatPerf') === '1'
  } catch {
    return false
  }
}

function logChatPerf(sessionKey: string, stage: string, startAt: number) {
  if (!isChatPerfLoggingEnabled()) return
  const elapsed = (nowMs() - startAt).toFixed(1)
  console.info(`[braian][chat-perf] ${sessionKey} ${stage} +${elapsed}ms`)
}

let threads: Record<string, ChatThreadState> = {}
const threadListeners = new Set<() => void>()

/** Separate from thread body updates so sidebar does not re-render on every token. */
let generatingSnapshot: Record<string, boolean> = {}
const generatingListeners = new Set<() => void>()

function emitThreads() {
  for (const l of threadListeners) l()
}

function emitGenerating() {
  for (const l of generatingListeners) l()
}

function getThread(key: string): ChatThreadState {
  ensureProfileThreadHydrated(key)
  return threads[key] ?? DEFAULT_CHAT_THREAD
}

function setGenerating(key: string, on: boolean) {
  const was = !!generatingSnapshot[key]
  if (was === on) return
  generatingSnapshot = on
    ? { ...generatingSnapshot, [key]: true }
    : Object.fromEntries(
        Object.entries(generatingSnapshot).filter(([k]) => k !== key),
      )
  emitGenerating()
}

function patchThread(
  key: string,
  patch: Partial<ChatThreadState> | ((prev: ChatThreadState) => ChatThreadState),
) {
  const prev = getThread(key)
  const next =
    typeof patch === 'function'
      ? patch(prev)
      : { ...prev, ...patch }
  if (next === prev) return
  threads = { ...threads, [key]: next }
  emitThreads()
  if (key === PROFILE_CHAT_SESSION_KEY) {
    scheduleProfileThreadPersist()
  }
}

const abortBySession = new Map<string, AbortController>()

/** Selection context for the next user turn (inline canvas prompt). Cleared when a turn starts. */
const pendingDocumentCanvasSelectionBySession = new Map<
  string,
  DocumentCanvasSelectionContext
>()

function appendAssistantTextDelta(
  parts: AssistantPart[] | undefined,
  delta: string,
): AssistantPart[] | undefined {
  if (!delta) return parts
  if (!parts || parts.length === 0) {
    return [{ type: 'text', text: delta }]
  }
  const last = parts[parts.length - 1]
  if (last.type === 'text') {
    return [
      ...parts.slice(0, -1),
      { type: 'text', text: last.text + delta },
    ]
  }
  return [...parts, { type: 'text', text: delta }]
}

function ensureOpenThinkingPart(parts: AssistantPart[] | undefined): AssistantPart[] {
  const base = parts ?? []
  const last = base[base.length - 1]
  if (last?.type === 'thinking' && last.status === 'streaming') return base
  return [...base, { type: 'thinking', text: '', status: 'streaming' as const }]
}

function appendThinkingDelta(
  parts: AssistantPart[] | undefined,
  delta: string,
): AssistantPart[] | undefined {
  if (!delta) return parts
  const base = ensureOpenThinkingPart(parts)
  const last = base[base.length - 1]
  if (last.type !== 'thinking') return base
  return [...base.slice(0, -1), { ...last, text: last.text + delta }]
}

function closeThinkingPart(
  parts: AssistantPart[] | undefined,
): AssistantPart[] | undefined {
  if (!parts?.length) return parts
  const last = parts[parts.length - 1]
  if (last.type === 'thinking' && last.status === 'streaming') {
    return [...parts.slice(0, -1), { ...last, status: 'done' as const }]
  }
  return parts
}

function appendToolStart(
  parts: AssistantPart[] | undefined,
  toolCallId: string,
  toolName: string,
): AssistantPart[] {
  const base = parts ?? []
  return [
    ...base,
    {
      type: 'tool',
      toolCallId,
      toolName,
      argsText: '',
      status: 'streaming',
    },
  ]
}

function appendToolArgs(
  parts: AssistantPart[] | undefined,
  toolCallId: string,
  delta: string,
): AssistantPart[] | undefined {
  if (!parts || !delta) return parts
  return parts.map((p) =>
    p.type === 'tool' && p.toolCallId === toolCallId
      ? { ...p, argsText: p.argsText + delta }
      : p,
  )
}

/** Avoid multi‑MB JSON.parse in chat UI (formatToolPayloadText) after tabular canvas tools. */
const TABULAR_CANVAS_TOOL_ARGS_ELIDE_LEN = 12_000

function finalizeToolPart(
  parts: AssistantPart[] | undefined,
  chunk: Extract<ChatStreamChunk, { type: 'tool-end' }>,
): AssistantPart[] | undefined {
  if (!parts) return undefined
  const resultSummary =
    chunk.result ??
    (chunk.input !== undefined
      ? typeof chunk.input === 'string'
        ? chunk.input
        : JSON.stringify(chunk.input)
      : undefined)
  return parts.map((p) => {
    if (p.type !== 'tool' || p.toolCallId !== chunk.toolCallId) return p
    const resolvedToolName = chunk.toolName || p.toolName
    return {
      ...p,
      toolName: resolvedToolName,
      status: 'done' as const,
      ...(resultSummary ? { result: resultSummary } : {}),
      ...(resolvedToolName === 'apply_tabular_canvas' &&
      (p.argsText?.length ?? 0) > TABULAR_CANVAS_TOOL_ARGS_ELIDE_LEN
        ? {
            argsText:
              '{"note":"Large apply_tabular_canvas arguments omitted; see the Data side panel."}',
          }
        : {}),
    }
  })
}

function updateAssistantMessage(
  messages: ChatMessage[],
  assistantId: string,
  fn: (m: AssistantChatMessage) => AssistantChatMessage,
): ChatMessage[] {
  let idx = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg?.role === 'assistant' && msg.id === assistantId) {
      idx = i
      break
    }
  }
  if (idx < 0) return messages
  const next = fn(messages[idx] as AssistantChatMessage)
  if (next === messages[idx]) return messages
  const out = [...messages]
  out[idx] = next
  return out
}

export function subscribeThreads(cb: () => void) {
  threadListeners.add(cb)
  return () => threadListeners.delete(cb)
}

export function subscribeGenerating(cb: () => void) {
  generatingListeners.add(cb)
  return () => generatingListeners.delete(cb)
}

export function getThreadSnapshot(key: string): ChatThreadState {
  ensureProfileThreadHydrated(key)
  return threads[key] ?? DEFAULT_CHAT_THREAD
}

/** Thread state only if this session has been hydrated or used (not DEFAULT placeholder). */
export function getThreadIfLoaded(sessionKey: string): ChatThreadState | null {
  if (!(sessionKey in threads)) return null
  return threads[sessionKey] ?? null
}

function normalizePendingUserMessages(raw: PendingUserTurn[] | undefined) {
  if (!raw?.length) return []
  return raw.map((item) =>
    typeof (item as unknown) === 'string'
      ? { content: item as unknown as string }
      : {
          content: item.content,
          ...(item.canvasSelection
            ? { canvasSelection: item.canvasSelection }
            : {}),
        },
  )
}

/** Replace the entire thread for a session (e.g. hydrate from disk). */
export function replaceThread(sessionKey: string, state: ChatThreadState) {
  threads = {
    ...threads,
    [sessionKey]: {
      ...state,
      generating: false,
      pendingUserMessages: normalizePendingUserMessages(state.pendingUserMessages),
      contextFiles: state.contextFiles ?? [],
      contextConversations: state.contextConversations ?? [],
      agentMode: deriveAgentModeFromPersisted(
        state.agentMode as string | undefined,
        (state as { appHarnessEnabled?: boolean }).appHarnessEnabled,
      ),
      reasoningMode: state.reasoningMode === 'thinking' ? 'thinking' : 'fast',
    },
  }
  emitThreads()
  if (sessionKey === PROFILE_CHAT_SESSION_KEY) {
    scheduleProfileThreadPersist()
  }
}

export function getGeneratingSnapshot(key: string): boolean {
  return !!generatingSnapshot[key]
}

export function setChatDraft(sessionKey: string, draft: string) {
  patchThread(sessionKey, (prev) =>
    prev.draft === draft ? prev : { ...prev, draft },
  )
}

export function patchDocumentArtifactBody(sessionKey: string, body: string) {
  patchThread(sessionKey, (prev) => {
    const p = prev.artifactPayload
    if (!p || p.kind !== 'document') return prev
    if (p.body === body) return prev
    const prevRev = p.canvasRevision ?? 0
    return {
      ...prev,
      artifactPayload: {
        ...p,
        body,
        canvasRevision: prevRev + 1,
      },
    }
  })
}

export function patchWorkspaceFileArtifactBody(sessionKey: string, body: string) {
  patchThread(sessionKey, (prev) => {
    const p = prev.artifactPayload
    if (!p || p.kind !== 'workspace-file') return prev
    if (p.body === body) return prev
    const prevRev = p.canvasRevision ?? 0
    return {
      ...prev,
      artifactPayload: {
        ...p,
        body,
        canvasRevision: prevRev + 1,
      },
    }
  })
}

/**
 * Load a workspace file into the side panel as a `workspace-file` artifact and open the panel.
 */
export async function openWorkspaceTextFileArtifact(
  sessionKey: string,
  workspaceId: string,
  relativePath: string,
  displayName: string,
) {
  const { text, truncated } = await workspaceReadTextFile(
    workspaceId,
    relativePath,
  )
  patchThread(sessionKey, (prev) => {
    const p = prev.artifactPayload
    const sameFile =
      p?.kind === 'workspace-file' && p.relativePath === relativePath
    const nextRev = sameFile ? (p.canvasRevision ?? 0) + 1 : 1
    return {
      ...prev,
      artifactOpen: true,
      artifactPayload: {
        kind: 'workspace-file',
        relativePath,
        body: text,
        truncated,
        title: displayName,
        canvasRevision: nextRev,
      },
    }
  })
}

/** Abort the current assistant stream for this session (explicit Stop). */
export function stopChatGeneration(sessionKey: string) {
  abortBySession.get(sessionKey)?.abort()
}

export function setChatAgentMode(sessionKey: string, agentMode: AgentMode) {
  patchThread(sessionKey, (prev) =>
    prev.agentMode === agentMode ? prev : { ...prev, agentMode },
  )
}

export function setChatReasoningMode(
  sessionKey: string,
  reasoningMode: 'fast' | 'thinking',
) {
  patchThread(sessionKey, (prev) =>
    prev.reasoningMode === reasoningMode ? prev : { ...prev, reasoningMode },
  )
}

export function setChatActiveMcpServers(
  sessionKey: string,
  serverNames: string[],
) {
  const normalized = Array.from(
    new Set(serverNames.map((s) => s.trim()).filter((s) => s.length > 0)),
  ).sort((a, b) => a.localeCompare(b))
  patchThread(sessionKey, (prev) => {
    const prevNames = prev.activeMcpServers ?? []
    if (
      prevNames.length === normalized.length &&
      prevNames.every((v, i) => normalized[i] === v)
    ) {
      return prev
    }
    return { ...prev, activeMcpServers: normalized }
  })
}

type SeedCanvasOpts = {
  title?: string
  canvasKind?: 'document' | 'tabular' | 'visual'
}

/**
 * Seed mock-browser demo threads only (empty threads, known conversation ids).
 * Does not open the artifact panel — it opens when the assistant emits canvas content
 * (e.g. `open_document_canvas` → artifact chunk).
 */
export function seedCanvasPreviewIfEmpty(
  sessionKey: string,
  conversationId: string | null,
  opts?: SeedCanvasOpts,
) {
  if (conversationId === null) return
  const prev = getThread(sessionKey)
  if (prev.messages.length > 0) return

  const conv = getConversationById(conversationId)
  const demoMessages = conv?.demoMessages
  if (!demoMessages || demoMessages.length === 0) return

  const payloadOpts = {
    title: opts?.title,
    canvasKind: opts?.canvasKind,
  }
  patchThread(sessionKey, {
    messages: demoMessages.map((m, i) => {
      if (m.role === 'user') {
        return {
          id: `seed-${conversationId}-${i}`,
          role: 'user' as const,
          content: m.content,
          createdAtMs: Date.now() - (demoMessages.length - i) * 60000,
        }
      }
      return {
        id: `seed-${conversationId}-${i}`,
        role: 'assistant' as const,
        content: m.content,
        status: 'complete' as const,
        createdAtMs: Date.now() - (demoMessages.length - i) * 60000,
      }
    }),
    artifactOpen: false,
    artifactPayload: getMockArtifactPayloadForChat(
      conversationId,
      payloadOpts,
    ),
  })
}

function startChatTurnInternal(sessionKey: string, trimmed: string) {
  const prev = getThread(sessionKey)

  const selectionForTurn =
    pendingDocumentCanvasSelectionBySession.get(sessionKey) ?? undefined
  if (selectionForTurn) {
    pendingDocumentCanvasSelectionBySession.delete(sessionKey)
  }

  const userContent =
    selectionForTurn != null
      ? formatCanvasSelectionUserMessage(trimmed, selectionForTurn)
      : trimmed

  const ac = new AbortController()
  abortBySession.set(sessionKey, ac)

  const userMsg = {
    id: createId(),
    role: 'user' as const,
    content: userContent,
    createdAtMs: Date.now(),
  }
  const assistantId = createId()
  const assistantMsg: AssistantChatMessage = {
    id: assistantId,
    role: 'assistant',
    content: '',
    status: 'streaming',
    createdAtMs: Date.now(),
  }

  setGenerating(sessionKey, true)
  patchThread(sessionKey, (p) => ({
    ...p,
    generating: true,
    messages: [...p.messages, userMsg, assistantMsg],
  }))

  void (async () => {
    let streamCompletedOk = false
    const turnStartAt = nowMs()
    let firstChunkSeen = false
    try {
      const { workspaceId, conversationId } = parseChatSessionKey(sessionKey)
      if (
        isTauri() &&
        !isUserProfileSessionId(workspaceId) &&
        !isNonWorkspaceScopedSessionId(workspaceId)
      ) {
        cancelWorkspaceMcpIdleDisconnect(workspaceId)
      }
      const threadNow = getThread(sessionKey)
      const agentMode = threadNow.agentMode ?? 'document'
      const activeMcpServers = (threadNow.activeMcpServers ?? [])
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
      const ap = threadNow.artifactPayload
      const live = getDocumentCanvasLivePayload(sessionKey)
      const documentCanvasSnapshot =
        isUserProfileSessionId(workspaceId)
          ? null
          : ap?.kind === 'document'
            ? {
                body: live?.body ?? ap.body,
                ...(ap.title !== undefined && ap.title !== ''
                  ? { title: ap.title }
                  : {}),
                revision: ap.canvasRevision ?? 0,
                ...(selectionForTurn
                  ? {
                      selection: selectionForTurn,
                      selectionUserInstruction: trimmed,
                    }
                  : {}),
              }
            : null

      const wfLive = getWorkspaceFileCanvasLivePayload(sessionKey)
      const workspaceFileCanvasSnapshot =
        isUserProfileSessionId(workspaceId)
          ? null
          : ap?.kind === 'workspace-file'
            ? {
                relativePath: ap.relativePath,
                body: wfLive?.body ?? ap.body,
                revision: ap.canvasRevision ?? 0,
                ...(ap.truncated === true ? { truncated: true as const } : {}),
                ...(ap.title !== undefined && ap.title !== ''
                  ? { title: ap.title }
                  : {}),
              }
            : null

      let contextFiles:
        | Awaited<ReturnType<typeof loadContextFilesForModel>>
        | undefined
      if (prev.contextFiles.length > 0) {
        if (isNonWorkspaceScopedSessionId(workspaceId)) {
          contextFiles = undefined
        } else if (!isTauri()) {
          contextFiles = prev.contextFiles.map((f) => ({
            relativePath: f.relativePath,
            ...(f.displayName != null && f.displayName !== ''
              ? { displayName: f.displayName }
              : {}),
            text: '[File contents load in the desktop app only; this is a web preview.]',
            fileTruncated: false,
          }))
        } else {
          try {
            const contextFilesStart = nowMs()
            contextFiles = await loadContextFilesForModel(
              workspaceId,
              prev.contextFiles,
            )
            if (contextFiles?.length) {
              logChatPerf(
                sessionKey,
                `context-files loaded (${contextFiles.length})`,
                contextFilesStart,
              )
            }
          } catch (e) {
            console.error('[braian] load context files', e)
            contextFiles = undefined
          }
        }
      }

      let contextPriorConversations:
        | Awaited<ReturnType<typeof loadContextConversationsForModel>>
        | undefined
      const ccEntries = prev.contextConversations ?? []
      if (ccEntries.length > 0) {
        if (isNonWorkspaceScopedSessionId(workspaceId)) {
          contextPriorConversations = undefined
        } else if (!isTauri()) {
          contextPriorConversations = ccEntries.map((c) => ({
            conversationId: c.conversationId,
            title: c.title?.trim() || c.conversationId,
            text: '[Prior conversation transcripts load in the desktop app only; this is a web preview.]',
            truncated: false,
          }))
        } else {
          try {
            const ccStart = nowMs()
            contextPriorConversations = await loadContextConversationsForModel(
              workspaceId,
              ccEntries,
              conversationId,
            )
            if (contextPriorConversations?.length) {
              logChatPerf(
                sessionKey,
                `context-conversations loaded (${contextPriorConversations.length})`,
                ccStart,
              )
            }
          } catch (e) {
            console.error('[braian] load context conversations', e)
            contextPriorConversations = undefined
          }
        }
      }

      const {
        priorMessages,
        workingMemory: conversationWorkingMemory,
        settings: settingsForTurn,
      } = await resolveChatHistoryForModelTurn({
        workspaceId,
        conversationId,
        prevMessages: prev.messages,
        signal: ac.signal,
      })

      const chatTurnContext = {
        workspaceId,
        conversationId,
        ...(isUserProfileSessionId(workspaceId)
          ? { turnKind: 'profile' as const }
          : {}),
        agentMode,
        documentCanvasSnapshot,
        workspaceFileCanvasSnapshot,
        onAgentModeChange: (mode: AgentMode) => {
          setChatAgentMode(sessionKey, mode)
        },
        ...(contextFiles != null && contextFiles.length > 0
          ? { contextFiles }
          : {}),
        ...(contextPriorConversations != null &&
        contextPriorConversations.length > 0
          ? { contextPriorConversations }
          : {}),
        ...(activeMcpServers.length > 0 ? { activeMcpServers } : {}),
        ...(conversationWorkingMemory != null
          ? { conversationWorkingMemory }
          : {}),
      }

      const argsBuildStart = nowMs()
      const streamArgs = await buildTanStackChatTurnArgs({
        userText: userContent,
        context: chatTurnContext,
        priorMessages,
        settings: settingsForTurn,
        skipSettingsValidation: false,
        reasoningMode: threadNow.reasoningMode === 'thinking' ? 'thinking' : 'fast',
      })
      logChatPerf(sessionKey, 'turn args built', argsBuildStart)
      patchThread(sessionKey, {
        lastModelRequestSnapshot: tanStackTurnArgsToSnapshot(streamArgs, userContent),
      })
      logChatPerf(sessionKey, 'snapshot ready', turnStartAt)

      for await (const chunk of streamChatTurn(
        userContent,
        ac.signal,
        chatTurnContext,
        priorMessages,
        {
          prebuiltTanStackArgs: streamArgs,
        },
      )) {
        if (!firstChunkSeen) {
          firstChunkSeen = true
          logChatPerf(sessionKey, `first chunk (${chunk.type})`, turnStartAt)
        }
        if (chunk.type === 'text-delta') {
          patchThread(sessionKey, (p) => ({
            ...p,
            messages: updateAssistantMessage(p.messages, assistantId, (m) => ({
              ...m,
              content: m.content + chunk.text,
              parts: appendAssistantTextDelta(m.parts, chunk.text),
            })),
          }))
        } else if (chunk.type === 'thinking-start') {
          patchThread(sessionKey, (p) => ({
            ...p,
            messages: updateAssistantMessage(p.messages, assistantId, (m) => ({
              ...m,
              parts: ensureOpenThinkingPart(m.parts),
            })),
          }))
        } else if (chunk.type === 'thinking-delta') {
          patchThread(sessionKey, (p) => ({
            ...p,
            messages: updateAssistantMessage(p.messages, assistantId, (m) => ({
              ...m,
              parts: appendThinkingDelta(m.parts, chunk.text),
            })),
          }))
        } else if (chunk.type === 'thinking-end') {
          patchThread(sessionKey, (p) => ({
            ...p,
            messages: updateAssistantMessage(p.messages, assistantId, (m) => ({
              ...m,
              parts: closeThinkingPart(m.parts),
            })),
          }))
        } else if (chunk.type === 'artifact') {
          patchThread(sessionKey, (p) => {
            let payload = chunk.payload
            if (payload.kind === 'document' && payload.canvasRevision == null) {
              const prevRev =
                p.artifactPayload?.kind === 'document'
                  ? (p.artifactPayload.canvasRevision ?? 0)
                  : 0
              payload = { ...payload, canvasRevision: prevRev + 1 }
            } else if (
              payload.kind === 'workspace-file' &&
              payload.canvasRevision == null
            ) {
              const samePath =
                p.artifactPayload?.kind === 'workspace-file' &&
                p.artifactPayload.relativePath === payload.relativePath
              const prevRev = samePath
                ? (p.artifactPayload.canvasRevision ?? 0)
                : 0
              payload = { ...payload, canvasRevision: prevRev + 1 }
            }
            return {
              ...p,
              artifactOpen: true,
              artifactPayload: payload,
            }
          })
        } else if (chunk.type === 'tool-start') {
          patchThread(sessionKey, (p) => ({
            ...p,
            messages: updateAssistantMessage(p.messages, assistantId, (m) => ({
              ...m,
              parts: appendToolStart(
                m.parts,
                chunk.toolCallId,
                chunk.toolName,
              ),
            })),
          }))
        } else if (chunk.type === 'tool-args-delta') {
          patchThread(sessionKey, (p) => ({
            ...p,
            messages: updateAssistantMessage(p.messages, assistantId, (m) => ({
              ...m,
              parts: appendToolArgs(m.parts, chunk.toolCallId, chunk.delta),
            })),
          }))
        } else if (chunk.type === 'tool-end') {
          patchThread(sessionKey, (p) => ({
            ...p,
            messages: updateAssistantMessage(p.messages, assistantId, (m) => ({
              ...m,
              parts: finalizeToolPart(m.parts, chunk),
            })),
          }))
        } else if (chunk.type === 'done') {
          patchThread(sessionKey, (p) => ({
            ...p,
            messages: updateAssistantMessage(p.messages, assistantId, (m) => ({
              ...m,
              status: 'complete' as const,
            })),
          }))
        }
      }
      logChatPerf(sessionKey, 'stream completed', turnStartAt)
      streamCompletedOk = true
    } catch (err) {
      const aborted =
        err instanceof DOMException && err.name === 'AbortError'
      const abortedError =
        err instanceof Error && err.name === 'AbortError'
      if (!aborted && !abortedError) {
        console.error('[braian] chat stream failed', err)
        const detail =
          err instanceof Error
            ? err.message
            : typeof err === 'string'
              ? err
              : 'Something went wrong while generating a reply.'
        const userLine =
          detail.length > 600 ? `${detail.slice(0, 600)}…` : detail
        patchThread(sessionKey, (p) => ({
          ...p,
          messages: updateAssistantMessage(p.messages, assistantId, (m) => ({
            ...m,
            content:
              m.content ||
              `Could not get a reply.\n\n${userLine}`,
            status: 'complete' as const,
          })),
        }))
      }
    } finally {
      try {
        const { workspaceId: mcpWsId } = parseChatSessionKey(sessionKey)
        if (
          isTauri() &&
          !isUserProfileSessionId(mcpWsId) &&
          !isNonWorkspaceScopedSessionId(mcpWsId)
        ) {
          scheduleWorkspaceMcpIdleDisconnect(mcpWsId)
        }
      } catch (e) {
        console.error('[braian] MCP session cleanup', e)
      }
      if (abortBySession.get(sessionKey) === ac) {
        abortBySession.delete(sessionKey)
      }
      setGenerating(sessionKey, false)
      patchThread(sessionKey, (p) => ({
        ...p,
        generating: false,
        messages: updateAssistantMessage(p.messages, assistantId, (m) =>
          m.status === 'streaming'
            ? { ...m, status: 'complete' as const }
            : m,
        ),
      }))

      const after = getThread(sessionKey)
      const { workspaceId, conversationId } = parseChatSessionKey(sessionKey)

      if (
        conversationId &&
        !isNonWorkspaceScopedSessionId(workspaceId) &&
        !isUserProfileSessionId(workspaceId)
      ) {
        const last = after.messages.at(-1)
        if (last?.role === 'assistant') {
          const path =
            typeof window !== 'undefined' ? window.location.pathname : ''
          if (path !== `/chat/${conversationId}`) {
            void Promise.all([
              import('@/lib/workspace-api'),
              import('@/lib/conversation-list-refresh'),
            ]).then(([{ conversationSetUnread }, refreshMod]) =>
              conversationSetUnread({
                id: conversationId,
                workspaceId,
                unread: true,
              })
                .then(() => refreshMod.requestConversationListRefresh())
                .catch((e) =>
                  console.error('[braian] conversationSetUnread', e),
                ),
            )
          }
        }
      }

      if (after.pendingUserMessages.length > 0) {
        const [next, ...rest] = after.pendingUserMessages
        patchThread(sessionKey, (p) => ({
          ...p,
          pendingUserMessages: rest,
        }))
        if (next.canvasSelection) {
          pendingDocumentCanvasSelectionBySession.set(
            sessionKey,
            next.canvasSelection,
          )
        }
        queueMicrotask(() => startChatTurnInternal(sessionKey, next.content))
      } else {
        if (
          streamCompletedOk &&
          conversationId &&
          isTauri() &&
          !isNonWorkspaceScopedSessionId(workspaceId) &&
          !isUserProfileSessionId(workspaceId)
        ) {
          void import('@/lib/workspace/workspace-activity').then((m) =>
            m.emitWorkspaceDurableActivity(workspaceId, {
              conversationId,
            }),
          )
        }
      }
    }
  })()
}

export type SendChatTurnOptions = {
  canvasSelection?: DocumentCanvasSelectionContext
}

export function sendChatTurn(
  sessionKey: string,
  text: string,
  options?: SendChatTurnOptions,
) {
  const trimmed = text.trim()
  if (!trimmed) return

  const prev = getThread(sessionKey)
  if (prev.generating) {
    patchThread(sessionKey, (p) => ({
      ...p,
      pendingUserMessages: [
        ...p.pendingUserMessages,
        {
          content: trimmed,
          ...(options?.canvasSelection
            ? { canvasSelection: options.canvasSelection }
            : {}),
        },
      ],
      draft: '',
    }))
    return
  }

  if (options?.canvasSelection) {
    pendingDocumentCanvasSelectionBySession.set(
      sessionKey,
      options.canvasSelection,
    )
  }

  patchThread(sessionKey, (p) => (p.draft === '' ? p : { ...p, draft: '' }))
  startChatTurnInternal(sessionKey, trimmed)
}

export function useChatThread(sessionKey: string): ChatThreadState {
  return useSyncExternalStore(
    subscribeThreads,
    () => getThreadSnapshot(sessionKey),
    () => DEFAULT_CHAT_THREAD,
  )
}

export function useSessionGenerating(sessionKey: string): boolean {
  return useSyncExternalStore(
    subscribeGenerating,
    () => getGeneratingSnapshot(sessionKey),
    () => false,
  )
}

export function addContextFileEntry(
  sessionKey: string,
  entry: ContextFileEntry,
) {
  patchThread(sessionKey, (p) => {
    if (p.contextFiles.some((x) => x.relativePath === entry.relativePath)) {
      return p
    }
    return {
      ...p,
      contextFiles: [
        ...p.contextFiles,
        {
          ...entry,
          addedAtMs: entry.addedAtMs ?? Date.now(),
        },
      ],
    }
  })
}

export function removeContextFileEntry(
  sessionKey: string,
  relativePath: string,
) {
  patchThread(sessionKey, (p) => ({
    ...p,
    contextFiles: p.contextFiles.filter((x) => x.relativePath !== relativePath),
  }))
}

export function addContextConversationEntry(
  sessionKey: string,
  entry: ContextConversationEntry,
) {
  patchThread(sessionKey, (p) => {
    const prevCc = p.contextConversations ?? []
    if (prevCc.some((x) => x.conversationId === entry.conversationId)) {
      return p
    }
    return {
      ...p,
      contextConversations: [
        ...prevCc,
        {
          ...entry,
          addedAtMs: entry.addedAtMs ?? Date.now(),
        },
      ],
    }
  })
}

export function removeContextConversationEntry(
  sessionKey: string,
  conversationId: string,
) {
  patchThread(sessionKey, (p) => ({
    ...p,
    contextConversations: (p.contextConversations ?? []).filter(
      (x) => x.conversationId !== conversationId,
    ),
  }))
}

export function useChatThreadActions() {
  const send = useCallback(
    (sessionKey: string, text: string, options?: SendChatTurnOptions) => {
      sendChatTurn(sessionKey, text, options)
    },
    [],
  )
  const setDraft = useCallback((sessionKey: string, draft: string) => {
    setChatDraft(sessionKey, draft)
  }, [])
  const patchDocBody = useCallback((sessionKey: string, body: string) => {
    patchDocumentArtifactBody(sessionKey, body)
  }, [])
  const patchWorkspaceFileBody = useCallback((sessionKey: string, body: string) => {
    patchWorkspaceFileArtifactBody(sessionKey, body)
  }, [])
  const stop = useCallback((sessionKey: string) => {
    stopChatGeneration(sessionKey)
  }, [])
  const setReasoning = useCallback(
    (sessionKey: string, mode: 'fast' | 'thinking') => {
      setChatReasoningMode(sessionKey, mode)
    },
    [],
  )
  const setActiveMcp = useCallback((sessionKey: string, names: string[]) => {
    setChatActiveMcpServers(sessionKey, names)
  }, [])
  return {
    sendChatTurn: send,
    setChatDraft: setDraft,
    patchDocumentArtifactBody: patchDocBody,
    patchWorkspaceFileArtifactBody: patchWorkspaceFileBody,
    stopChatGeneration: stop,
    setChatAgentMode,
    setChatReasoningMode: setReasoning,
    setChatActiveMcpServers: setActiveMcp,
    addContextFileEntry,
    removeContextFileEntry,
    addContextConversationEntry,
    removeContextConversationEntry,
  }
}
