import type { ContextPriorConversationForModel } from '@/lib/ai/types'
import { chatMessageContentForLlmHistory } from '@/lib/chat-sessions/chat-message-llm-history'
import type {
  ChatMessage,
  ContextConversationEntry,
} from '@/lib/chat-sessions/types'
import { conversationOpen } from '@/lib/workspace-api'

/** Cap total injected characters for prior-chat transcripts (separate budget from attached files). */
const MAX_TOTAL_CHARS = 350_000

function formatThreadForModel(messages: ChatMessage[]): string {
  const blocks: string[] = []
  for (const m of messages) {
    const body = chatMessageContentForLlmHistory(m).trim()
    if (!body) continue
    blocks.push(`${m.role.toUpperCase()}:\n${body}`)
  }
  return blocks.join('\n\n')
}

/**
 * Loads pinned prior conversations for the model. Skips self-reference and
 * conversations outside `workspaceId`.
 */
export async function loadContextConversationsForModel(
  workspaceId: string,
  entries: ContextConversationEntry[],
  currentConversationId: string | null,
): Promise<ContextPriorConversationForModel[]> {
  const out: ContextPriorConversationForModel[] = []
  let total = 0

  for (const e of entries) {
    if (total >= MAX_TOTAL_CHARS) break
    if (
      currentConversationId != null &&
      e.conversationId === currentConversationId
    ) {
      continue
    }

    let opened: Awaited<ReturnType<typeof conversationOpen>> = null
    try {
      opened = await conversationOpen(e.conversationId)
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : typeof err === 'string' ? err : 'Unknown error'
      out.push({
        conversationId: e.conversationId,
        title: e.title?.trim() || e.conversationId,
        text: `[Could not open conversation: ${msg}]`,
        truncated: false,
      })
      continue
    }

    if (!opened) {
      out.push({
        conversationId: e.conversationId,
        title: e.title?.trim() || e.conversationId,
        text: '[Conversation not found.]',
        truncated: false,
      })
      continue
    }

    if (opened.conversation.workspaceId !== workspaceId) {
      out.push({
        conversationId: e.conversationId,
        title: e.title?.trim() || opened.conversation.title,
        text: '[Conversation is in a different workspace and was not included.]',
        truncated: false,
      })
      continue
    }

    const title =
      e.title?.trim() ||
      opened.conversation.title?.trim() ||
      e.conversationId
    const rawText = formatThreadForModel(opened.thread.messages)
    const room = MAX_TOTAL_CHARS - total
    let text = rawText
    let truncated = false
    if (text.length > room) {
      text = text.slice(0, room)
      truncated = true
    }
    total += text.length
    out.push({
      conversationId: e.conversationId,
      title,
      text,
      ...(truncated ? { truncated: true } : {}),
    })
  }

  return out
}
