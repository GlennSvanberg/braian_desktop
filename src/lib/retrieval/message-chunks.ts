import { estimateTextTokens } from '@/lib/ai/token-estimate'
import type { AiProviderId } from '@/lib/ai/model-catalog'

const TOKEN_OPTS = { provider: 'openai' as AiProviderId, modelId: 'gpt-4o' }

export type MessageChunk = {
  messageStart: number
  messageEnd: number
  text: string
}

/** 0-based message indices inclusive. */
export function chunkMessagesByTokens(
  messages: ReadonlyArray<{ role: string; content: string }>,
  maxTokens: number,
  overlapRatio: number,
): MessageChunk[] {
  const maxTok = Math.max(128, maxTokens)
  const overlap = Math.min(0.3, Math.max(0, overlapRatio))
  if (messages.length === 0) return []

  const out: MessageChunk[] = []
  let start = 0

  while (start < messages.length) {
    let end = start
    for (; end < messages.length; end++) {
      const slice = messages.slice(start, end + 1)
      const body = slice
        .map((m) => `${m.role}: ${m.content}`)
        .join('\n\n')
      const tok = estimateTextTokens(body, TOKEN_OPTS)
      if (tok > maxTok && end > start) {
        end -= 1
        break
      }
      if (tok >= maxTok) break
    }
    if (end < start) end = start
    const slice = messages.slice(start, end + 1)
    const body = slice.map((m) => `${m.role}: ${m.content}`).join('\n\n')
    if (body.trim()) {
      out.push({
        messageStart: start,
        messageEnd: end,
        text: body,
      })
    }
    const span = end - start + 1
    const overlapMsgs = Math.max(1, Math.floor(span * overlap))
    start = Math.max(start + 1, end + 1 - overlapMsgs)
  }

  return out
}
