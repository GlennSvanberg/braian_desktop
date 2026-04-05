import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/ai/mock-mode', () => ({ isMockAiMode: () => false }))

vi.mock('@/lib/ai-settings-api', () => ({
  aiSettingsGet: vi.fn(),
}))

vi.mock('@/lib/workspace-api', () => ({
  workspaceReadTextFile: vi.fn().mockRejectedValue(new Error('no file')),
  workspaceListDir: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/ai/mcp-tools', () => ({
  buildMcpTools: vi
    .fn()
    .mockResolvedValue({ tools: [], warnings: [], serverNames: [] }),
}))

import {
  buildTanStackChatTurnArgs,
  documentCanvasSnapshotPrompt,
  PROFILE_COACH_SYSTEM,
} from '@/lib/ai/chat-turn-args'
import { MEMORY_RELATIVE_PATH } from '@/lib/memory/constants'
import { USER_PROFILE_WORKSPACE_SESSION_ID } from '@/lib/chat-sessions/detached'
import { aiSettingsGet } from '@/lib/ai-settings-api'
import { workspaceReadTextFile } from '@/lib/workspace-api'

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
    expect(r.systemSections[0]?.text).toContain('Unsaved chat')
    expect(r.systemSections[0]?.text).not.toContain('apply_document_canvas_patch')
    expect(r.reasoningMode).toBe('fast')
    expect(r.modelOptions).toBeUndefined()
  })

  it('includes canvas tools when conversationId is set', async () => {
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
      r.toolsDisplay.some((t) => t.name === 'apply_document_canvas_patch'),
    ).toBe(true)
    expect(
      r.toolsDisplay.some((t) => t.name === 'open_document_canvas'),
    ).toBe(true)
    expect(r.systemSections[0]?.text).toContain('apply_document_canvas_patch')
    expect(r.systemSections[0]?.text).not.toContain('Unsaved chat')
  })

  it('documentCanvasSnapshotPrompt includes revision and patch guidance', () => {
    const text = documentCanvasSnapshotPrompt({
      body: '# Hello',
      revision: 3,
    })
    expect(text).toContain('Canvas revision: **3**')
    expect(text).toContain('apply_document_canvas_patch')
  })

  it('documentCanvasSnapshotPrompt includes selection when provided', () => {
    const text = documentCanvasSnapshotPrompt({
      body: '# Doc',
      revision: 0,
      selection: {
        selectedMarkdown: 'snippet',
        sectionOnly: true,
      },
    })
    expect(text).toContain('Canvas selection')
    expect(text).toContain('snippet')
  })

  it('documentCanvasSnapshotPrompt adds binding when selectionUserInstruction is set', () => {
    const text = documentCanvasSnapshotPrompt({
      body: '# Doc',
      revision: 1,
      selection: { selectedMarkdown: 'hello', sectionOnly: true },
      selectionUserInstruction: 'reverse it',
    })
    expect(text).toContain('Canvas selection turn')
    expect(text).toContain('reverse it')
    expect(text).toContain('The fenced **Canvas selection** markdown above is the target')
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
    expect(r.systemSections[0]?.id).toBe('routing-doc')
    expect(r.systemSections[0]?.text).toContain('switch_to_code_agent')
    expect(r.systemSections[0]?.text).toContain('__lazy__tool__discovery__')
    expect(r.systemSections.some((s) => s.id === 'skills-create')).toBe(false)
    expect(r.systemSections.some((s) => s.id === 'skills-catalog')).toBe(true)
    expect(
      r.toolsDisplay.some((t) => t.name === 'list_workspace_skills'),
    ).toBe(true)
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
    expect(r.systemSections[0]?.id).toBe('routing-code')
    expect(r.systemSections[0]?.text).not.toContain('switch_to_code_agent')
    expect(r.systemSections[0]?.text).not.toContain(
      'call `switch_to_code_agent`, then immediately `__lazy__tool__discovery__`',
    )
    expect(r.systemSections.some((s) => s.id === 'skills-create')).toBe(false)
  })

  it('code mode includes shell, search, and patch tools eagerly', async () => {
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
    const shell = r.toolsDisplay.find((t) => t.name === 'run_workspace_shell')
    expect(shell).toBeDefined()
    expect(shell?.lazy).toBeUndefined()

    const search = r.toolsDisplay.find((t) => t.name === 'search_workspace')
    expect(search).toBeDefined()
    expect(search?.lazy).toBeUndefined()

    const patch = r.toolsDisplay.find((t) => t.name === 'patch_workspace_file')
    expect(patch).toBeDefined()
    expect(patch?.lazy).toBeUndefined()
  })

  it('document mode has shell, search, and patch tools as lazy', async () => {
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
    const shell = r.toolsDisplay.find((t) => t.name === 'run_workspace_shell')
    expect(shell?.lazy).toBe(true)

    const search = r.toolsDisplay.find((t) => t.name === 'search_workspace')
    expect(search?.lazy).toBe(true)

    const patch = r.toolsDisplay.find((t) => t.name === 'patch_workspace_file')
    expect(patch?.lazy).toBe(true)
  })

  it('code mode routing includes tool selection guide', async () => {
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
    const routing = r.systemSections.find((s) => s.id === 'routing-code')
    expect(routing?.text).toContain('search_workspace')
    expect(routing?.text).toContain('patch_workspace_file')
    expect(routing?.text).toContain('run_workspace_shell')
    expect(routing?.text).toContain('Tool selection guide')
  })

  it('canvas tools include tabular and visual when conversationId is set', async () => {
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
      r.toolsDisplay.some((t) => t.name === 'apply_tabular_canvas'),
    ).toBe(true)
    expect(
      r.toolsDisplay.some((t) => t.name === 'apply_visual_canvas'),
    ).toBe(true)
  })

  it('code mode maxIterations is 40 base', async () => {
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
    expect(r.maxIterations).toBe(40)
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
    expect(r.systemSections[0]?.text).toContain('switch_to_app_builder')
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
    expect(r.systemSections[0]?.text).not.toContain('switch_to_app_builder')
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
    const routingIdx = r.systemSections.findIndex((s) => s.id === 'routing-doc')
    const userIdx = r.systemSections.findIndex((s) => s.id === 'user-context')
    expect(routingIdx).toBeLessThan(userIdx)
  })

  it('OpenAI gpt-5 maps reasoningMode to modelOptions', async () => {
    vi.mocked(aiSettingsGet).mockResolvedValue({
      ...validSettings,
      modelId: 'gpt-5.4',
    })
    const fast = await buildTanStackChatTurnArgs({
      userText: 'hi',
      context: { workspaceId: 'ws', conversationId: 'c1', agentMode: 'document' },
      priorMessages: [],
      skipSettingsValidation: true,
      reasoningMode: 'fast',
    })
    expect(fast.reasoningMode).toBe('fast')
    expect(fast.modelOptions).toEqual({ reasoning: { effort: 'none' } })

    const think = await buildTanStackChatTurnArgs({
      userText: 'hi',
      context: { workspaceId: 'ws', conversationId: 'c1', agentMode: 'document' },
      priorMessages: [],
      skipSettingsValidation: true,
      reasoningMode: 'thinking',
    })
    expect(think.modelOptions).toEqual({ reasoning: { effort: 'medium' } })
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
    expect(r.systemSections.some((s) => s.id === 'skills-create')).toBe(false)
    expect(
      r.toolsDisplay.some((t) => t.name === 'list_workspace_skills'),
    ).toBe(false)
    expect(r.systemSections[0]?.text).not.toContain('switch_to_app_builder')
    expect(r.systemSections[0]?.text).not.toContain('switch_to_code_agent')
  })

  it('testcases.md §5: injects workspace memory when MEMORY.md is readable', async () => {
    vi.mocked(workspaceReadTextFile).mockImplementation(
      async (_ws: string, rel: string) => {
        if (rel === MEMORY_RELATIVE_PATH) {
          return {
            text: 'Always call the product **WidgetPro**, never Acme.',
            truncated: false,
          }
        }
        throw new Error('no file')
      },
    )
    const r = await buildTanStackChatTurnArgs({
      userText: 'What is our product called?',
      context: {
        workspaceId: 'ws',
        conversationId: 'c1',
        agentMode: 'document',
      },
      priorMessages: [],
      skipSettingsValidation: true,
    })
    const mem = r.systemSections.find((s) => s.id === 'memory')
    expect(mem).toBeDefined()
    expect(mem?.text).toMatch(/WidgetPro/)
    vi.mocked(workspaceReadTextFile).mockReset()
    vi.mocked(workspaceReadTextFile).mockRejectedValue(new Error('no file'))
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
    expect(r.systemSections.some((s) => s.id === 'skills-create')).toBe(false)
  })
})
