import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/ai/mock-mode', () => ({ isMockAiMode: () => false }))

vi.mock('@/lib/ai-settings-api', () => ({
  aiSettingsGet: vi.fn(),
}))

vi.mock('@/lib/workspace-api', () => ({
  workspaceReadTextFile: vi.fn().mockRejectedValue(new Error('no file')),
}))

import {
  buildTanStackChatTurnArgs,
  PROFILE_COACH_SYSTEM,
} from '@/lib/ai/chat-turn-args'
import { USER_PROFILE_WORKSPACE_SESSION_ID } from '@/lib/chat-sessions/detached'
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

  it('uses lazy dashboard tools and switch_to_app_builder when harness is off', async () => {
    const r = await buildTanStackChatTurnArgs({
      userText: 'hi',
      context: {
        workspaceId: 'ws',
        conversationId: 'c1',
        agentMode: 'document',
        appHarnessEnabled: false,
      },
      priorMessages: [],
      skipSettingsValidation: true,
    })
    const dashRead = r.toolsDisplay.find(
      (t) => t.name === 'read_workspace_dashboard',
    )
    expect(dashRead?.lazy).toBe(true)
    expect(
      r.toolsDisplay.some((t) => t.name === 'switch_to_app_builder'),
    ).toBe(true)
    expect(r.systemSections.some((s) => s.id === 'app-builder')).toBe(false)
  })

  it('includes eager dashboard tools, app-builder section, no switch when harness on', async () => {
    const r = await buildTanStackChatTurnArgs({
      userText: 'hi',
      context: {
        workspaceId: 'ws',
        conversationId: 'c1',
        agentMode: 'document',
        appHarnessEnabled: true,
      },
      priorMessages: [],
      skipSettingsValidation: true,
    })
    const dashRead = r.toolsDisplay.find(
      (t) => t.name === 'read_workspace_dashboard',
    )
    expect(dashRead?.lazy).toBeUndefined()
    expect(
      r.toolsDisplay.some((t) => t.name === 'apply_workspace_dashboard'),
    ).toBe(true)
    expect(r.toolsDisplay.some((t) => t.name === 'upsert_workspace_page')).toBe(
      true,
    )
    expect(
      r.toolsDisplay.some((t) => t.name === 'switch_to_app_builder'),
    ).toBe(false)
    expect(r.systemSections.some((s) => s.id === 'app-builder')).toBe(true)
  })

  it('includes user-context section with ISO time on default turns', async () => {
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
    const uc = r.systemSections.find((s) => s.id === 'user-context')
    expect(uc).toBeDefined()
    expect(uc?.text).toMatch(/ISO:/)
    expect(uc?.text).toMatch(/User profile/)
  })

  it('profile turnKind uses coach prompt and only update_user_profile', async () => {
    const r = await buildTanStackChatTurnArgs({
      userText: 'hi',
      context: {
        workspaceId: USER_PROFILE_WORKSPACE_SESSION_ID,
        conversationId: null,
        turnKind: 'profile',
      },
      priorMessages: [],
      skipSettingsValidation: true,
    })
    expect(r.toolsDisplay.map((t) => t.name)).toEqual(['update_user_profile'])
    expect(r.systemSections[0]?.text).toBe(PROFILE_COACH_SYSTEM)
    expect(
      r.systemSections.some((s) => s.id === 'profile-state'),
    ).toBe(true)
    expect(r.systemSections.some((s) => s.id === 'user-context')).toBe(false)
    expect(r.isCodeMode).toBe(false)
    expect(r.maxIterations).toBe(16)
  })

  it('omits dashboard tools when workspace is detached even if harness on', async () => {
    const r = await buildTanStackChatTurnArgs({
      userText: 'hi',
      context: {
        workspaceId: '__braian_detached__',
        conversationId: 'c1',
        agentMode: 'document',
        appHarnessEnabled: true,
      },
      priorMessages: [],
      skipSettingsValidation: true,
    })
    expect(
      r.toolsDisplay.some((t) => t.name === 'read_workspace_dashboard'),
    ).toBe(false)
    expect(
      r.toolsDisplay.some((t) => t.name === 'switch_to_app_builder'),
    ).toBe(false)
    expect(r.systemSections.some((s) => s.id === 'app-builder')).toBe(false)
  })

  it('omits dashboard tools for user profile workspace id even if harness on', async () => {
    const r = await buildTanStackChatTurnArgs({
      userText: 'hi',
      context: {
        workspaceId: USER_PROFILE_WORKSPACE_SESSION_ID,
        conversationId: 'c1',
        agentMode: 'document',
        appHarnessEnabled: true,
      },
      priorMessages: [],
      skipSettingsValidation: true,
    })
    expect(
      r.toolsDisplay.some((t) => t.name === 'read_workspace_dashboard'),
    ).toBe(false)
    expect(
      r.systemSections.some((s) => s.id === 'app-builder'),
    ).toBe(false)
  })
})
