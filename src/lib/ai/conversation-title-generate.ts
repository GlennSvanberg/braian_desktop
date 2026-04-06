import { deriveConversationTitle } from '@/lib/conversation-title'

import { completeChatText } from './complete-text'
import { isMockAiMode } from './mock-mode'

const TITLE_SYSTEM = `You label chat conversations for a sidebar list.
Reply with a short title only: 3–8 words, plain language, describing the user's topic.
No quotes, no markdown, no trailing punctuation, no preamble or explanation.`

const USER_SNIPPET_MAX = 3000

/**
 * Normalize model output; if empty after cleanup, fall back to heuristic from the original message.
 */
export function sanitizeAiTitleOutput(
  raw: string,
  fallbackUserText: string,
): string {
  const trimmed = raw.trim()
  const firstLine = (trimmed.split(/\r?\n/)[0] ?? trimmed).trim()
  const quoteChars = /^["'`\u201c\u2018]+|["'`\u201d\u2019]+$/g
  let s = firstLine.replace(quoteChars, '').trim()
  s = s.replace(/[\u0000-\u001F\u007F]/g, '').trim()
  if (!s) return deriveConversationTitle(fallbackUserText)
  return deriveConversationTitle(s)
}

/**
 * Short title for a chat: AI summary when possible, else same heuristic as {@link deriveConversationTitle}.
 */
export async function generateConversationTitleFromUserMessage(
  userMessageText: string,
  options?: { signal?: AbortSignal },
): Promise<string> {
  const heuristic = deriveConversationTitle(userMessageText)
  if (isMockAiMode()) {
    return heuristic
  }

  const trimmed = userMessageText.trim()
  if (!trimmed) {
    return heuristic
  }

  try {
    const snippet =
      trimmed.length > USER_SNIPPET_MAX
        ? `${trimmed.slice(0, USER_SNIPPET_MAX)}…`
        : trimmed
    const raw = await completeChatText({
      systemPrompts: [TITLE_SYSTEM],
      userMessage: `First user message:\n\n${snippet}`,
      signal: options?.signal,
    })
    return sanitizeAiTitleOutput(raw, userMessageText)
  } catch {
    return heuristic
  }
}
