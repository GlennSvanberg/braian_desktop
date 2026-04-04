import { useCallback, useSyncExternalStore } from 'react'

import { streamChatTurn } from '@/lib/ai'
import {
  buildTanStackChatTurnArgs,
  tanStackTurnArgsToSnapshot,
} from '@/lib/ai/chat-turn-args'
import { discoveryResultIncludesCodeTools } from '@/lib/ai/coding-tools'
import { discoveryResultIncludesDashboardTools } from '@/lib/ai/dashboard-tools'
import type { ChatStreamChunk } from '@/lib/ai/types'
import { loadContextFilesForModel } from '@/lib/context-files-for-ai'
import { getMockArtifactPayloadForChat } from '@/lib/artifacts'
import { getConversationById } from '@/lib/mock-workspace-data'
import { isTauri } from '@/lib/tauri-env'
import type { AgentMode } from '@/lib/workspace-api'

import {
  isDetachedWorkspaceSessionId,
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
  type ContextFileEntry,
} from './types'

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
      agentMode: parsed.agentMode === 'code' ? 'code' : 'document',
      appHarnessEnabled: false,
      contextFiles: [],
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
      }
      localStorage.setItem(PROFILE_THREAD_LS_KEY, JSON.stringify(payload))
    } catch (e) {
      console.error('[braian] profile chat persist', e)
    }
  }, 400)
}

/** Include tool traces so follow-up turns stay grounded in prior workspace reads/runs. */
function assistantContentForLlmHistory(m: AssistantChatMessage): string {
  const parts = m.parts
  if (!parts?.length) return m.content
  const blocks: string[] = []
  for (const p of parts) {
    if (p.type === 'text' && p.text.trim()) {
      blocks.push(p.text)
    } else if (p.type === 'tool') {
      const bits = [`[Tool ${p.toolName}]`]
      if (p.argsText?.trim()) bits.push(`Input: ${p.argsText}`)
      if (p.result?.trim()) bits.push(`Output: ${p.result}`)
      blocks.push(bits.join('\n'))
    }
  }
  const merged = blocks.join('\n\n').trim()
  return merged || m.content
}

export function chatMessageContentForLlmHistory(m: ChatMessage): string {
  if (m.role === 'user') return m.content
  return assistantContentForLlmHistory(m)
}

function createId() {
  return `m-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
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
  return parts.map((p) =>
    p.type === 'tool' && p.toolCallId === chunk.toolCallId
      ? {
          ...p,
          toolName: chunk.toolName || p.toolName,
          status: 'done' as const,
          ...(resultSummary ? { result: resultSummary } : {}),
        }
      : p,
  )
}

function mapAssistant(
  messages: ChatMessage[],
  assistantId: string,
  fn: (m: AssistantChatMessage) => AssistantChatMessage,
): ChatMessage[] {
  return messages.map((m) => {
    if (m.role !== 'assistant' || m.id !== assistantId) return m
    return fn(m)
  })
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

/** Replace the entire thread for a session (e.g. hydrate from disk). */
export function replaceThread(sessionKey: string, state: ChatThreadState) {
  threads = {
    ...threads,
    [sessionKey]: {
      ...state,
      generating: false,
      pendingUserMessages: state.pendingUserMessages ?? [],
      contextFiles: state.contextFiles ?? [],
      agentMode: state.agentMode ?? 'document',
      appHarnessEnabled: state.appHarnessEnabled ?? false,
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
    return { ...prev, artifactPayload: { ...p, body } }
  })
}

/** Abort the current assistant stream for this session (explicit Stop). */
export function stopChatGeneration(sessionKey: string) {
  abortBySession.get(sessionKey)?.abort()
}

export function setChatAgentMode(
  sessionKey: string,
  agentMode: 'document' | 'code',
) {
  patchThread(sessionKey, (prev) =>
    prev.agentMode === agentMode ? prev : { ...prev, agentMode },
  )
}

export function setChatAppHarnessEnabled(
  sessionKey: string,
  appHarnessEnabled: boolean,
) {
  patchThread(sessionKey, (prev) =>
    prev.appHarnessEnabled === appHarnessEnabled
      ? prev
      : { ...prev, appHarnessEnabled },
  )
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
        }
      }
      return {
        id: `seed-${conversationId}-${i}`,
        role: 'assistant' as const,
        content: m.content,
        status: 'complete' as const,
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

  const ac = new AbortController()
  abortBySession.set(sessionKey, ac)

  const userMsg = {
    id: createId(),
    role: 'user' as const,
    content: trimmed,
  }
  const assistantId = createId()
  const assistantMsg: AssistantChatMessage = {
    id: assistantId,
    role: 'assistant',
    content: '',
    status: 'streaming',
  }

  setGenerating(sessionKey, true)
  patchThread(sessionKey, (p) => ({
    ...p,
    generating: true,
    messages: [...p.messages, userMsg, assistantMsg],
  }))

  const priorMessages = prev.messages.map((m) => ({
    role: m.role,
    content: chatMessageContentForLlmHistory(m),
  }))

  void (async () => {
    let streamCompletedOk = false
    try {
      const { workspaceId, conversationId } = parseChatSessionKey(sessionKey)
      const threadNow = getThread(sessionKey)
      const agentMode = threadNow.agentMode ?? 'document'
      const appHarnessEnabled = threadNow.appHarnessEnabled ?? false
      const ap = threadNow.artifactPayload
      const documentCanvasSnapshot =
        isUserProfileSessionId(workspaceId)
          ? null
          : ap?.kind === 'document'
            ? {
                body: ap.body,
                ...(ap.title !== undefined && ap.title !== ''
                  ? { title: ap.title }
                  : {}),
              }
            : null

      let contextFiles:
        | Awaited<ReturnType<typeof loadContextFilesForModel>>
        | undefined
      if (prev.contextFiles.length > 0) {
        if (
          isDetachedWorkspaceSessionId(workspaceId) ||
          isUserProfileSessionId(workspaceId)
        ) {
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
            contextFiles = await loadContextFilesForModel(
              workspaceId,
              prev.contextFiles,
            )
          } catch (e) {
            console.error('[braian] load context files', e)
            contextFiles = undefined
          }
        }
      }

      const chatTurnContext = {
        workspaceId,
        conversationId,
        ...(isUserProfileSessionId(workspaceId)
          ? { turnKind: 'profile' as const }
          : {}),
        agentMode,
        appHarnessEnabled,
        documentCanvasSnapshot,
        onAgentModeChange: (mode: AgentMode) => {
          if (mode === 'code') {
            setChatAgentMode(sessionKey, 'code')
          }
        },
        onAppHarnessEnabledChange: (enabled: boolean) => {
          if (enabled) {
            setChatAppHarnessEnabled(sessionKey, true)
          }
        },
        ...(contextFiles != null && contextFiles.length > 0
          ? { contextFiles }
          : {}),
      }

      try {
        const args = await buildTanStackChatTurnArgs({
          userText: trimmed,
          context: chatTurnContext,
          priorMessages,
          skipSettingsValidation: true,
        })
        patchThread(sessionKey, {
          lastModelRequestSnapshot: tanStackTurnArgsToSnapshot(args, trimmed),
        })
      } catch (e) {
        console.error('[braian] model request snapshot', e)
      }

      for await (const chunk of streamChatTurn(
        trimmed,
        ac.signal,
        chatTurnContext,
        priorMessages,
      )) {
        if (chunk.type === 'text-delta') {
          patchThread(sessionKey, (p) => ({
            ...p,
            messages: mapAssistant(p.messages, assistantId, (m) => ({
              ...m,
              content: m.content + chunk.text,
              parts: appendAssistantTextDelta(m.parts, chunk.text),
            })),
          }))
        } else if (chunk.type === 'artifact') {
          patchThread(sessionKey, (p) => ({
            ...p,
            artifactOpen: true,
            artifactPayload: chunk.payload,
          }))
        } else if (chunk.type === 'tool-start') {
          patchThread(sessionKey, (p) => ({
            ...p,
            messages: mapAssistant(p.messages, assistantId, (m) => ({
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
            messages: mapAssistant(p.messages, assistantId, (m) => ({
              ...m,
              parts: appendToolArgs(m.parts, chunk.toolCallId, chunk.delta),
            })),
          }))
        } else if (chunk.type === 'tool-end') {
          if (chunk.toolName === '__lazy__tool__discovery__') {
            if (discoveryResultIncludesCodeTools(chunk.result)) {
              setChatAgentMode(sessionKey, 'code')
            }
            if (discoveryResultIncludesDashboardTools(chunk.result)) {
              setChatAppHarnessEnabled(sessionKey, true)
            }
          }
          patchThread(sessionKey, (p) => ({
            ...p,
            messages: mapAssistant(p.messages, assistantId, (m) => ({
              ...m,
              parts: finalizeToolPart(m.parts, chunk),
            })),
          }))
        } else if (chunk.type === 'done') {
          patchThread(sessionKey, (p) => ({
            ...p,
            messages: mapAssistant(p.messages, assistantId, (m) => ({
              ...m,
              status: 'complete' as const,
            })),
          }))
        }
      }
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
          messages: mapAssistant(p.messages, assistantId, (m) => ({
            ...m,
            content:
              m.content ||
              `Could not get a reply.\n\n${userLine}`,
            status: 'complete' as const,
          })),
        }))
      }
    } finally {
      if (abortBySession.get(sessionKey) === ac) {
        abortBySession.delete(sessionKey)
      }
      setGenerating(sessionKey, false)
      patchThread(sessionKey, (p) => ({
        ...p,
        generating: false,
        messages: mapAssistant(p.messages, assistantId, (m) =>
          m.status === 'streaming'
            ? { ...m, status: 'complete' as const }
            : m,
        ),
      }))

      const after = getThread(sessionKey)
      const { workspaceId, conversationId } = parseChatSessionKey(sessionKey)

      if (
        conversationId &&
        !isDetachedWorkspaceSessionId(workspaceId) &&
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
        queueMicrotask(() => startChatTurnInternal(sessionKey, next))
      } else {
        if (
          streamCompletedOk &&
          conversationId &&
          isTauri() &&
          !isDetachedWorkspaceSessionId(workspaceId) &&
          !isUserProfileSessionId(workspaceId)
        ) {
          void import('@/lib/memory/scheduler').then((m) =>
            m.scheduleMemoryReviewAfterIdle(workspaceId, conversationId),
          )
        }
      }
    }
  })()
}

export function sendChatTurn(sessionKey: string, text: string) {
  const trimmed = text.trim()
  if (!trimmed) return

  const prev = getThread(sessionKey)
  if (prev.generating) {
    patchThread(sessionKey, (p) => ({
      ...p,
      pendingUserMessages: [...p.pendingUserMessages, trimmed],
      draft: '',
    }))
    return
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

export function useChatThreadActions() {
  const send = useCallback((sessionKey: string, text: string) => {
    sendChatTurn(sessionKey, text)
  }, [])
  const setDraft = useCallback((sessionKey: string, draft: string) => {
    setChatDraft(sessionKey, draft)
  }, [])
  const patchDocBody = useCallback((sessionKey: string, body: string) => {
    patchDocumentArtifactBody(sessionKey, body)
  }, [])
  const stop = useCallback((sessionKey: string) => {
    stopChatGeneration(sessionKey)
  }, [])
  return {
    sendChatTurn: send,
    setChatDraft: setDraft,
    patchDocumentArtifactBody: patchDocBody,
    stopChatGeneration: stop,
    setChatAgentMode,
    setChatAppHarnessEnabled,
    addContextFileEntry,
    removeContextFileEntry,
  }
}
