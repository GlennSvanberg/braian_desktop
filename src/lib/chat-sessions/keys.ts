/** Stable id for a chat thread within a workspace (saved convo or draft /new). */
export function chatSessionKey(
  workspaceId: string,
  conversationId: string | null,
): string {
  return conversationId
    ? `${workspaceId}::${conversationId}`
    : `${workspaceId}::draft`
}

const DRAFT_MARKER = 'draft'

export type ParsedChatSessionKey = {
  workspaceId: string
  conversationId: string | null
}

/** Inverse of `chatSessionKey` (workspace ids must not contain `::`). */
export function parseChatSessionKey(sessionKey: string): ParsedChatSessionKey {
  const idx = sessionKey.lastIndexOf('::')
  if (idx <= 0) {
    return { workspaceId: sessionKey, conversationId: null }
  }
  const workspaceId = sessionKey.slice(0, idx)
  const tail = sessionKey.slice(idx + 2)
  return {
    workspaceId,
    conversationId: tail === DRAFT_MARKER ? null : tail,
  }
}
