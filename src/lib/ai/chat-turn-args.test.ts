import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/ai/mock-mode', () => ({ isMockAiMode: () => false }))

vi.mock('@/lib/ai-settings-api', () => ({
  aiSettingsGet: vi.fn(),
}))

vi.mock('@/lib/workspace-api', () => ({
  workspaceReadTextFile: vi.fn().mockRejectedValue(new Error('no file')),
}))

import { buildTanStackChatTurnArgs } from '@/lib/ai/chat-turn-args'
import { aiSettingsGet } from '@/lib/ai-settings-api'

const validSettings = {
  provider: 'openai' as const,
  apiKey: 'test-key',
  modelId: 'gpt-4o-mini',
  baseUrl: null as string | null,
}

describe('buildTanStackChatTurnArgs', () => {
  beforeEach(() => {
    vi.mocked(aiSettingsGet).mockResolvedValue(validSettings)
  })

  it('throws when settings invalid and skipSettingsValidation is false', async () => {
    vi.mocked(aiSettingsGet).mockResolvedValue({
      ...validSettings,
      apiKey: '',
    })
    await expect(
      buildTanStackChatTurnArgs({
        userText: 'hi',
        context: { workspaceId: 'ws', conversationId: null },
        priorMessages: [],
        skipSettingsValidation: false,
      }),
    ).rejects.toThrow(/API key/)
  })

  it('omits canvas tool when conversationId is null', async () => {
    const r = await buildTanStackChatTurnArgs({
      userText: 'hi',
      context: {
        workspaceId: 'ws',
        conversationId: null,
        agentMode: 'document',
      },
      priorMessages: [],
      skipSettingsValidation: true,
    })
    expect(
      r.toolsDisplay.some((t) => t.name === 'open_document_canvas'),
    ).toBe(false)
  })

  it('includes canvas tool when conversationId is set', async () => {
    const r = await buildTanStackChatTurnArgs({
      userText: 'hi',
      context: {
        workspaceId: 'ws',
        conversationId: 'c1',
        agentMode: 'document',
      },
      priorMessages: [],
      skipSettingsValidation: true,
    })
    expect(
      r.toolsDisplay.some((t) => t.name === 'open_document_canvas'),
    ).toBe(true)
  })

  it('document mode uses lazy coding tools and switch_to_code_agent', async () => {
    const r = await buildTanStackChatTurnArgs({
      userText: 'hi',
      context: {
        workspaceId: 'ws',
        conversationId: null,
        agentMode: 'document',
      },
      priorMessages: [],
      skipSettingsValidation: true,
    })
    const read = r.toolsDisplay.find((t) => t.name === 'read_workspace_file')
    expect(read?.lazy).toBe(true)
    expect(
      r.toolsDisplay.some((t) => t.name === 'switch_to_code_agent'),
    ).toBe(true)
    expect(r.systemSections[0]?.id).toBe('primary-doc')
  })

  it('code mode uses eager coding tools and no switch tool', async () => {
    const r = await buildTanStackChatTurnArgs({
      userText: 'hi',
      context: {
        workspaceId: 'ws',
        conversationId: null,
        agentMode: 'code',
      },
      priorMessages: [],
      skipSettingsValidation: true,
    })
    const read = r.toolsDisplay.find((t) => t.name === 'read_workspace_file')
    expect(read?.lazy).toBeUndefined()
    expect(
      r.toolsDisplay.some((t) => t.name === 'switch_to_code_agent'),
    ).toBe(false)
    expect(r.systemSections[0]?.id).toBe('primary-code')
  })

  it('appends user message to prior messages', async () => {
    const r = await buildTanStackChatTurnArgs({
      userText: 'last',
      context: { workspaceId: 'ws', conversationId: null },
      priorMessages: [{ role: 'user', content: 'first' }],
      skipSettingsValidation: true,
    })
    expect(r.messages).toEqual([
      { role: 'user', content: 'first' },
      { role: 'user', content: 'last' },
    ])
  })
})
