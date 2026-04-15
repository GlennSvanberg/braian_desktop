import { estimateTextTokens } from '@/lib/ai/token-estimate'
import type { AiProviderId } from '@/lib/ai/model-catalog'

const TOKEN_OPTS = { provider: 'openai' as AiProviderId, modelId: 'gpt-4o' }

export type TextChunk = {
  text: string
  lineStart: number
  lineEnd: number
}

/**
 * Split plain text into overlapping token-bounded chunks with 1-based line ranges.
 */
export function chunkPlainText(
  text: string,
  options: { maxTokens: number; overlapRatio: number },
): TextChunk[] {
  const maxTok = Math.max(64, options.maxTokens)
  const overlapRatio = Math.min(0.35, Math.max(0, options.overlapRatio))
  const lines = text.split('\n')
  if (lines.length === 0) return []

  const out: TextChunk[] = []
  let startLineIdx = 0

  while (startLineIdx < lines.length) {
    let endLineIdx = startLineIdx
    let bestTok = 0
    for (; endLineIdx < lines.length; endLineIdx++) {
      const segment = lines.slice(startLineIdx, endLineIdx + 1).join('\n')
      const tok = estimateTextTokens(segment, TOKEN_OPTS)
      if (tok > maxTok && endLineIdx > startLineIdx) {
        endLineIdx -= 1
        break
      }
      bestTok = tok
      if (tok >= maxTok) {
        break
      }
    }
    if (endLineIdx < startLineIdx) {
      endLineIdx = startLineIdx
    }
    let segment = lines.slice(startLineIdx, endLineIdx + 1).join('\n')
    if (!segment.length && startLineIdx < lines.length) {
      segment = lines[startLineIdx]
      endLineIdx = startLineIdx
    }
    if (!segment.trim()) {
      startLineIdx = endLineIdx + 1
      continue
    }
    void bestTok
    out.push({
      text: segment,
      lineStart: startLineIdx + 1,
      lineEnd: endLineIdx + 1,
    })
    const span = endLineIdx - startLineIdx + 1
    const overlapLines = Math.max(1, Math.floor(span * overlapRatio))
    startLineIdx = Math.max(startLineIdx + 1, endLineIdx + 1 - overlapLines)
  }

  return out
}
