import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/ai/complete-text', () => ({
  completeChatText: vi.fn(),
}))

vi.mock('@/lib/ai/mock-mode', () => ({
  isMockAiMode: vi.fn(),
}))

import { completeChatText } from '@/lib/ai/complete-text'
import { isMockAiMode } from '@/lib/ai/mock-mode'
import {
  generateConversationTitleFromUserMessage,
  sanitizeAiTitleOutput,
} from '@/lib/ai/conversation-title-generate'
import {
  DEFAULT_CHAT_TITLE,
  deriveConversationTitle,
} from '@/lib/conversation-title'

const mockedComplete = vi.mocked(completeChatText)
const mockedMockAi = vi.mocked(isMockAiMode)

describe('sanitizeAiTitleOutput', () => {
  it('strips surrounding quotes and uses first line', () => {
    expect(sanitizeAiTitleOutput(`"Planning a trip"\nextra`, 'x')).toBe(
      'Planning a trip',
    )
  })

  it('falls back to heuristic when model output is empty', () => {
    const user = 'Hello there friend'
    expect(sanitizeAiTitleOutput('  \n  ', user)).toBe(
      deriveConversationTitle(user),
    )
  })
})

describe('generateConversationTitleFromUserMessage', () => {
  beforeEach(() => {
    mockedComplete.mockReset()
    mockedMockAi.mockReset()
  })

  it('uses heuristic only in mock AI mode without calling the API', async () => {
    mockedMockAi.mockReturnValue(true)
    const user = 'Write a poem about spring'
    const out = await generateConversationTitleFromUserMessage(user)
    expect(out).toBe(deriveConversationTitle(user))
    expect(mockedComplete).not.toHaveBeenCalled()
  })

  it('returns sanitized model text when API succeeds', async () => {
    mockedMockAi.mockReturnValue(false)
    mockedComplete.mockResolvedValue('  Short AI title  ')
    const user = 'Long user message about many things'
    const out = await generateConversationTitleFromUserMessage(user)
    expect(out).toBe('Short AI title')
    expect(mockedComplete).toHaveBeenCalledTimes(1)
  })

  it('falls back to heuristic when API throws', async () => {
    mockedMockAi.mockReturnValue(false)
    mockedComplete.mockRejectedValue(new Error('network'))
    const user = 'Something something'
    const out = await generateConversationTitleFromUserMessage(user)
    expect(out).toBe(deriveConversationTitle(user))
  })

  it('returns default for empty user text', async () => {
    mockedMockAi.mockReturnValue(false)
    const out = await generateConversationTitleFromUserMessage('   ')
    expect(out).toBe(DEFAULT_CHAT_TITLE)
    expect(mockedComplete).not.toHaveBeenCalled()
  })
})
