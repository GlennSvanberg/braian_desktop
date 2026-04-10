import { describe, expect, it } from 'vitest'

import { estimateChatHistoryTokens, estimateTextTokens } from '@/lib/ai/token-estimate'

const opt = { provider: 'openai' as const, modelId: 'gpt-4o-mini' }

describe('token-estimate', () => {
  it('estimateTextTokens returns 0 for empty string', () => {
    expect(estimateTextTokens('', opt)).toBe(0)
  })

  it('estimateTextTokens increases with longer text', () => {
    const a = estimateTextTokens('hello', opt)
    const b = estimateTextTokens('hello '.repeat(50), opt)
    expect(b).toBeGreaterThan(a)
  })

  it('estimateChatHistoryTokens sums message rows', () => {
    const n = estimateChatHistoryTokens(
      [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'there' },
      ],
      opt,
    )
    expect(n).toBeGreaterThan(0)
  })
})
