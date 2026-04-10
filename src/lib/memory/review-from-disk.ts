import { conversationOpen } from '@/lib/workspace-api'

import { runMemoryReviewForConversation, type MemoryReviewResult } from './review'

/**
 * Load the conversation from disk and run a manual memory merge (for workspace
 * settings when the chat thread is not hydrated in the in-memory store).
 */
export async function runMemoryReviewFromConversationDisk(
  workspaceId: string,
  conversationId: string,
): Promise<MemoryReviewResult> {
  const open = await conversationOpen(conversationId)
  if (!open) {
    return { ok: false, error: 'Conversation not found.' }
  }
  if (open.conversation.workspaceId !== workspaceId) {
    return {
      ok: false,
      error: 'That chat does not belong to this workspace.',
    }
  }
  return runMemoryReviewForConversation({
    workspaceId,
    conversationId,
    thread: open.thread,
    manual: true,
  })
}
