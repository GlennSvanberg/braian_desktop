import type { ChatMessage, ChatThreadState } from '@/lib/chat-sessions/types'
import { MEMORY_REVIEW_MAX_MESSAGES } from './constants'
import { formatMessagesForMemoryReview } from './format-transcript'
import {
  getLastReviewedUserMessageId,
  readMemoryReviewState,
  setLastReviewedUserMessageId,
  writeMemoryReviewState,
} from './review-state'
import { queueStructuredSuggestionsFromReviewExcerpt } from './suggestion-extraction'

export type MemoryReviewResult =
  | { ok: true; skipped: true; reason: string }
  | { ok: true; skipped: false }
  | { ok: false; error: string }

const queueTail = new Map<string, Promise<unknown>>()

export function withMemoryReviewMutex<T>(
  workspaceId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = queueTail.get(workspaceId) ?? Promise.resolve()
  const result = prev.then(() => fn())
  queueTail.set(
    workspaceId,
    result.then(
      () => undefined,
      () => undefined,
    ),
  )
  return result
}

function sliceMessagesSinceLastReview(
  messages: ChatMessage[],
  lastUserId: string | null,
  maxMessages: number,
): ChatMessage[] {
  if (lastUserId == null) {
    return messages.slice(-maxMessages)
  }
  let startIdx = -1
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (m.role === 'user' && m.id === lastUserId) {
      startIdx = i
      break
    }
  }
  if (startIdx < 0) {
    return messages.slice(-maxMessages)
  }
  const slice = messages.slice(startIdx + 1)
  if (slice.length === 0) return []
  return slice.length > maxMessages ? slice.slice(-maxMessages) : slice
}

function lastUserMessageId(messages: ChatMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === 'user') return m.id
  }
  return null
}

export async function runMemoryReviewForConversation(options: {
  workspaceId: string
  conversationId: string
  thread: ChatThreadState
  manual?: boolean
  signal?: AbortSignal
}): Promise<MemoryReviewResult> {
  const { workspaceId, conversationId, thread, manual, signal } = options

  return withMemoryReviewMutex(workspaceId, async () => {
    try {
      const state = await readMemoryReviewState(workspaceId)
      const lastId = getLastReviewedUserMessageId(state, conversationId)
      const slice = sliceMessagesSinceLastReview(
        thread.messages,
        lastId,
        MEMORY_REVIEW_MAX_MESSAGES,
      )

      if (slice.length === 0) {
        return {
          ok: true,
          skipped: true,
          reason: manual
            ? 'No new messages since the last memory update.'
            : 'No new messages to review.',
        }
      }

      const transcript = formatMessagesForMemoryReview(slice)

      await queueStructuredSuggestionsFromReviewExcerpt({
        workspaceId,
        conversationId,
        transcriptExcerpt: transcript,
        signal,
      })

      const lastUser = lastUserMessageId(thread.messages)
      const nextState = setLastReviewedUserMessageId(
        state,
        conversationId,
        lastUser,
      )
      await writeMemoryReviewState(workspaceId, nextState)

      return { ok: true, skipped: false }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { ok: false, error: msg }
    }
  })
}
