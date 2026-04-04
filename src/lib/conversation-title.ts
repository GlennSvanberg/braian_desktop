/** Matches default title in `conversation_create` (Rust). */
export const DEFAULT_CHAT_TITLE = 'New chat'

const DEFAULT_MAX_LEN = 72

function stripControlChars(s: string): string {
  return s.replace(/[\u0000-\u001F\u007F]/g, '')
}

/**
 * Build a short chat title from the first user message (first line, trimmed, collapsed whitespace).
 */
export function deriveConversationTitle(
  text: string,
  maxLen: number = DEFAULT_MAX_LEN,
): string {
  const trimmed = text.trim()
  if (!trimmed) return DEFAULT_CHAT_TITLE
  const firstLine = trimmed.split(/\r?\n/)[0] ?? trimmed
  const collapsed = firstLine.replace(/\s+/g, ' ').trim()
  const cleaned = stripControlChars(collapsed)
  if (!cleaned) return DEFAULT_CHAT_TITLE
  if (cleaned.length <= maxLen) return cleaned
  const sliceEnd = Math.max(0, maxLen - 1)
  return `${cleaned.slice(0, sliceEnd)}…`
}
