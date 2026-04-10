import { describe, expect, it } from 'vitest'

import { takeSuffixWithinTokenBudget } from '@/lib/conversation/working-memory'

import type { ChatMessage } from '@/lib/chat-sessions/types'

const tok = { provider: 'openai' as const, modelId: 'gpt-4o-mini' }

function user(id: string, content: string): ChatMessage {
  return { id, role: 'user', content, createdAtMs: 1 }
}

describe('takeSuffixWithinTokenBudget', () => {
  it('returns full list when under budget', () => {
    const msgs = [user('1', 'a'), user('2', 'b')]
    const { suffix, prefix } = takeSuffixWithinTokenBudget(msgs, 100_000, tok)
    expect(prefix).toHaveLength(0)
    expect(suffix).toHaveLength(2)
  })

  it('drops oldest messages first when over budget', () => {
    const msgs = [
      user('1', 'x'.repeat(5000)),
      user('2', 'y'.repeat(5000)),
      user('3', 'z'.repeat(5000)),
    ]
    const { suffix, prefix } = takeSuffixWithinTokenBudget(msgs, 200, tok)
    expect(prefix.length).toBeGreaterThan(0)
    expect(suffix.length).toBeGreaterThan(0)
    expect(suffix[suffix.length - 1]?.id).toBe('3')
  })
})
