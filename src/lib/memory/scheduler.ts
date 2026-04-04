import { chatSessionKey } from '@/lib/chat-sessions/keys'
import { getThreadIfLoaded } from '@/lib/chat-sessions/store'
import { isTauri } from '@/lib/tauri-env'

import {
  MEMORY_REVIEW_DEBOUNCE_MS,
  MEMORY_REVIEW_MIN_INTERVAL_MS,
} from './constants'
import { memorySettingsGet } from './memory-settings'
import {
  type MemoryReviewResult,
  runMemoryReviewForConversation,
} from './review'

const pendingConversations = new Map<string, Set<string>>()
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()
const lastSuccessRunByWorkspace = new Map<string, number>()

function runWhenIdle(fn: () => void): void {
  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(() => fn(), { timeout: 15_000 })
  } else {
    queueMicrotask(fn)
  }
}

async function processWorkspaceBatch(workspaceId: string, batch: string[]) {
  let anySuccess = false
  for (const conversationId of batch) {
    const sessionKey = chatSessionKey(workspaceId, conversationId)
    const thread = getThreadIfLoaded(sessionKey)
    if (!thread || thread.messages.length === 0) continue

    const r = await runMemoryReviewForConversation({
      workspaceId,
      conversationId,
      thread,
      manual: false,
    })
    if (r.ok && !r.skipped) anySuccess = true
    else if (!r.ok) {
      console.warn('[braian] memory review failed', conversationId, r.error)
    }
  }
  if (anySuccess) {
    lastSuccessRunByWorkspace.set(workspaceId, Date.now())
  }
}

function runDebounced(workspaceId: string) {
  debounceTimers.delete(workspaceId)

  const ids = pendingConversations.get(workspaceId)
  if (!ids?.size) return

  const last = lastSuccessRunByWorkspace.get(workspaceId) ?? 0
  const now = Date.now()
  if (
    last > 0 &&
    now - last < MEMORY_REVIEW_MIN_INTERVAL_MS
  ) {
    const wait = MEMORY_REVIEW_MIN_INTERVAL_MS - (now - last)
    debounceTimers.set(
      workspaceId,
      setTimeout(() => runDebounced(workspaceId), wait),
    )
    return
  }

  const batch = Array.from(ids)
  pendingConversations.set(workspaceId, new Set())

  runWhenIdle(() => {
    void processWorkspaceBatch(workspaceId, batch)
  })
}

/**
 * Mark conversations dirty and (re)start idle debounce for auto memory review.
 */
export function scheduleMemoryReviewAfterIdle(
  workspaceId: string,
  conversationId: string,
): void {
  if (!isTauri() || !memorySettingsGet().autoReviewOnIdle) return

  let set = pendingConversations.get(workspaceId)
  if (!set) {
    set = new Set()
    pendingConversations.set(workspaceId, set)
  }
  set.add(conversationId)

  const existing = debounceTimers.get(workspaceId)
  if (existing) clearTimeout(existing)

  const t = setTimeout(
    () => runDebounced(workspaceId),
    MEMORY_REVIEW_DEBOUNCE_MS,
  )
  debounceTimers.set(workspaceId, t)
}

/** Immediate merge from the loaded chat thread (manual action). */
export async function runMemoryReviewNow(
  workspaceId: string,
  conversationId: string,
): Promise<MemoryReviewResult> {
  const sessionKey = chatSessionKey(workspaceId, conversationId)
  const thread = getThreadIfLoaded(sessionKey)
  if (!thread || thread.messages.length === 0) {
    return {
      ok: false,
      error:
        'No loaded messages for this chat. Open the conversation in chat and try again.',
    }
  }
  return runMemoryReviewForConversation({
    workspaceId,
    conversationId,
    thread,
    manual: true,
  })
}
