import { completeChatText } from '@/lib/ai/complete-text'
import type { ChatMessage, ChatThreadState } from '@/lib/chat-sessions/types'
import { workspaceReadTextFile, workspaceWriteTextFile } from '@/lib/workspace-api'

import {
  MEMORY_RELATIVE_PATH,
  MEMORY_REVIEW_MAX_MESSAGES,
  MEMORY_REVIEW_READ_MAX_BYTES,
} from './constants'
import { formatMessagesForMemoryReview } from './format-transcript'
import {
  getLastReviewedUserMessageId,
  readMemoryReviewState,
  setLastReviewedUserMessageId,
  writeMemoryReviewState,
} from './review-state'

const REVIEWER_SYSTEM = `You maintain a workspace memory file (Markdown) for Braian Desktop.

Rules:
- Output ONLY the full replacement Markdown body for the memory file. No preamble or explanation.
- Prefer bullet lists under existing sections (Preferences, Decisions, Open questions). Add sections if needed.
- Include only durable, workspace-specific facts that were stated or clearly implied in the conversation.
- Merge with the previous memory: update contradictions, do not duplicate.
- Omit transient chit-chat, one-off tasks, and tool error noise.
- Never invent names, dates, or commitments that did not appear in the input.
- Do not store secrets, API keys, or credentials.`

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

export function parseMemoryMdOutput(raw: string): string {
  let t = raw.trim()
  const fence =
    /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```(?:\s*$|\s*\n)/m.exec(t)
  if (fence) return fence[1].trim()
  const loose = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```/m.exec(t)
  if (loose) return loose[1].trim()
  return t
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

      let memoryText = ''
      try {
        const r = await workspaceReadTextFile(
          workspaceId,
          MEMORY_RELATIVE_PATH,
          MEMORY_REVIEW_READ_MAX_BYTES,
        )
        memoryText = r.text
      } catch {
        memoryText = ''
      }

      const transcript = formatMessagesForMemoryReview(slice)
      const userPayload = `Current memory file (\`${MEMORY_RELATIVE_PATH}\`):

---
${memoryText.trim() || '(empty or missing)'}
---

Conversation excerpt to merge (most recent turns; roles preserved):

---
${transcript}
---

Return the complete updated Markdown for the memory file only.`

      const raw = await completeChatText({
        systemPrompts: [REVIEWER_SYSTEM],
        userMessage: userPayload,
        signal,
      })

      const nextMd = parseMemoryMdOutput(raw)
      if (!nextMd.trim()) {
        return { ok: false, error: 'Model returned empty memory content.' }
      }

      await workspaceWriteTextFile(
        workspaceId,
        MEMORY_RELATIVE_PATH,
        nextMd.endsWith('\n') ? nextMd : `${nextMd}\n`,
      )

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
