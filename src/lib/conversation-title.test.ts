import { describe, expect, it } from 'vitest'

import {
  DEFAULT_CHAT_TITLE,
  deriveConversationTitle,
} from '@/lib/conversation-title'

describe('deriveConversationTitle', () => {
  it('returns default for empty or whitespace', () => {
    expect(deriveConversationTitle('')).toBe(DEFAULT_CHAT_TITLE)
    expect(deriveConversationTitle('   \n\t  ')).toBe(DEFAULT_CHAT_TITLE)
  })

  it('uses first line only', () => {
    expect(deriveConversationTitle('Hello world\nsecond line')).toBe(
      'Hello world',
    )
  })

  it('collapses internal whitespace', () => {
    expect(deriveConversationTitle('a   b\tc')).toBe('a b c')
  })

  it('truncates long strings with ellipsis', () => {
    const long = 'x'.repeat(100)
    const out = deriveConversationTitle(long, 10)
    expect(out.length).toBe(10)
    expect(out.endsWith('…')).toBe(true)
  })

  it('strips control characters', () => {
    expect(deriveConversationTitle('Hi\u0000there')).toBe('Hithere')
  })
})
