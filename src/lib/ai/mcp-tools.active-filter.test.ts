import { beforeEach, describe, expect, it, vi } from 'vitest'

import { buildMcpTools } from '@/lib/ai/mcp-tools'

const listToolsMock = vi.fn()
const callToolMock = vi.fn()

vi.mock('@/lib/tauri-env', () => ({
  isTauri: () => true,
}))

vi.mock('@/lib/chat-sessions/detached', () => ({
  isNonWorkspaceScopedSessionId: () => false,
}))

vi.mock('@/lib/mcp-runtime-api', () => ({
  workspaceMcpListTools: (...args: unknown[]) => listToolsMock(...args),
  workspaceMcpCallTool: (...args: unknown[]) => callToolMock(...args),
}))

describe('buildMcpTools active server filtering', () => {
  beforeEach(() => {
    listToolsMock.mockReset()
    callToolMock.mockReset()
  })

  it('skips MCP listing when no active servers are selected', async () => {
    const result = await buildMcpTools({
      workspaceId: 'ws-1',
      conversationId: 'c-1',
      activeMcpServers: [],
    })
    expect(result.tools).toHaveLength(0)
    expect(listToolsMock).not.toHaveBeenCalled()
  })

  it('passes active servers allowlist to workspaceMcpListTools', async () => {
    listToolsMock.mockResolvedValueOnce({
      servers: [
        {
          name: 'azure-devops',
          tools: [{ name: 'work_items_search', inputSchema: { type: 'object' } }],
        },
      ],
    })

    const result = await buildMcpTools({
      workspaceId: 'ws-1',
      conversationId: 'c-1',
      activeMcpServers: ['azure-devops', 'atlassian'],
    })

    expect(result.tools.length).toBe(1)
    expect(listToolsMock).toHaveBeenCalledWith('ws-1', [
      'atlassian',
      'azure-devops',
    ])
  })
})
