import { useCallback, useSyncExternalStore } from 'react'

import { streamChatTurn } from '@/lib/ai'
import { getMockArtifactPayloadForChat } from '@/lib/artifacts'
import { getConversationById } from '@/lib/mock-workspace-data'

import { parseChatSessionKey } from './keys'
import { DEFAULT_CHAT_THREAD, type ChatThreadState } from './types'

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
}

const abortBySession = new Map<string, AbortController>()

export function subscribeThreads(cb: () => void) {
  threadListeners.add(cb)
  return () => threadListeners.delete(cb)
}

export function subscribeGenerating(cb: () => void) {
  generatingListeners.add(cb)
  return () => generatingListeners.delete(cb)
}

export function getThreadSnapshot(key: string): ChatThreadState {
  return threads[key] ?? DEFAULT_CHAT_THREAD
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

/** Open the workspace canvas with the mock payload for this saved chat (empty threads only). */
export function seedCanvasPreviewIfEmpty(
  sessionKey: string,
  conversationId: string | null,
) {
  if (conversationId === null) return
  const prev = getThread(sessionKey)
  if (prev.messages.length > 0) return

  const conv = getConversationById(conversationId)
  const demoMessages = conv?.demoMessages
  if (demoMessages && demoMessages.length > 0) {
    patchThread(sessionKey, {
      messages: demoMessages.map((m, i) => ({
        id: `seed-${conversationId}-${i}`,
        role: m.role,
        content: m.content,
        status: 'complete' as const,
      })),
      artifactOpen: true,
      artifactPayload: getMockArtifactPayloadForChat(conversationId),
    })
    return
  }

  if (prev.artifactPayload !== null) return
  patchThread(sessionKey, {
    artifactOpen: true,
    artifactPayload: getMockArtifactPayloadForChat(conversationId),
  })
}

export function sendChatTurn(sessionKey: string, text: string) {
  const trimmed = text.trim()
  if (!trimmed) return

  const prev = getThread(sessionKey)
  if (prev.generating) return

  const existing = abortBySession.get(sessionKey)
  existing?.abort()
  const ac = new AbortController()
  abortBySession.set(sessionKey, ac)

  const userMsg = {
    id: createId(),
    role: 'user' as const,
    content: trimmed,
  }
  const assistantId = createId()
  const assistantMsg = {
    id: assistantId,
    role: 'assistant' as const,
    content: '',
    status: 'streaming' as const,
  }

  setGenerating(sessionKey, true)
  patchThread(sessionKey, (p) => ({
    ...p,
    draft: '',
    generating: true,
    messages: [...p.messages, userMsg, assistantMsg],
  }))

  void (async () => {
    try {
      const { workspaceId, conversationId } = parseChatSessionKey(sessionKey)
      for await (const chunk of streamChatTurn(trimmed, ac.signal, {
        workspaceId,
        conversationId,
      })) {
        if (chunk.type === 'text-delta') {
          patchThread(sessionKey, (p) => ({
            ...p,
            messages: p.messages.map((m) =>
              m.id === assistantId
                ? { ...m, content: m.content + chunk.text }
                : m,
            ),
          }))
        } else if (chunk.type === 'artifact') {
          patchThread(sessionKey, (p) => ({
            ...p,
            artifactOpen: true,
            artifactPayload: chunk.payload,
          }))
        } else if (chunk.type === 'done') {
          patchThread(sessionKey, (p) => ({
            ...p,
            messages: p.messages.map((m) =>
              m.id === assistantId ? { ...m, status: 'complete' as const } : m,
            ),
          }))
        }
      }
    } catch (err) {
      const aborted =
        err instanceof DOMException && err.name === 'AbortError'
      const abortedError =
        err instanceof Error && err.name === 'AbortError'
      if (!aborted && !abortedError) {
        patchThread(sessionKey, (p) => ({
          ...p,
          messages: p.messages.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content:
                    m.content ||
                    'Something went wrong while generating a reply.',
                  status: 'complete' as const,
                }
              : m,
          ),
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
        messages: p.messages.map((m) =>
          m.id === assistantId && m.status === 'streaming'
            ? { ...m, status: 'complete' as const }
            : m,
        ),
      }))
    }
  })()
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
  return {
    sendChatTurn: send,
    setChatDraft: setDraft,
    patchDocumentArtifactBody: patchDocBody,
  }
}
