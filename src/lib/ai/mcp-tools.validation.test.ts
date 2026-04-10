import { beforeEach, describe, expect, it, vi } from 'vitest'

import { buildMcpTools } from '@/lib/ai/mcp-tools'

const listToolsMock = vi.fn()
const callToolMock = vi.fn()
const listTimeoutMsMock = vi.fn()

vi.mock('@/lib/tauri-env', () => ({
  isTauri: () => true,
}))

vi.mock('@/lib/chat-sessions/detached', () => ({
  isNonWorkspaceScopedSessionId: () => false,
}))

vi.mock('@/lib/mcp-runtime-api', () => ({
  workspaceMcpListTools: (...args: unknown[]) => listToolsMock(...args),
  workspaceMcpCallTool: (...args: unknown[]) => callToolMock(...args),
  workspaceMcpListTimeoutMs: (...args: unknown[]) => listTimeoutMsMock(...args),
}))

describe('MCP tool AJV argument validation', () => {
  beforeEach(() => {
    listToolsMock.mockReset()
    callToolMock.mockReset()
    listTimeoutMsMock.mockReset()
    listTimeoutMsMock.mockResolvedValue(30_000)
  })

  it('fails fast for missing required keys', async () => {
    listToolsMock.mockResolvedValueOnce({
      servers: [
        {
          name: 'p360-rest',
          tools: [
            {
              name: 'get_entity_fields_grouped',
              description: 'Get fields',
              inputSchema: {
                type: 'object',
                required: ['entity'],
                properties: {
                  entity: { type: 'string' },
                },
              },
            },
          ],
        },
      ],
    })

    const out = await buildMcpTools(
      {
        workspaceId: 'ws-1',
        conversationId: 'c-1',
        activeMcpServers: ['p360-rest'],
      },
      { useLooseMcpInputSchemaForOpenAi: true },
    )

    const execute = out.tools[0]?.execute
    expect(execute).toBeTypeOf('function')
    const res = await execute!({})
    expect(res.ok).toBe(false)
    expect(res.error).toContain('Missing required keys: entity')
    expect(callToolMock).not.toHaveBeenCalled()
  })

  it('calls MCP runtime when args satisfy schema', async () => {
    callToolMock.mockResolvedValueOnce('ok')
    listToolsMock.mockResolvedValueOnce({
      servers: [
        {
          name: 'p360-rest',
          tools: [
            {
              name: 'get_entity_fields_grouped',
              description: 'Get fields',
              inputSchema: {
                type: 'object',
                required: ['entity'],
                properties: {
                  entity: { type: 'string' },
                },
              },
            },
          ],
        },
      ],
    })

    const out = await buildMcpTools(
      {
        workspaceId: 'ws-1',
        conversationId: 'c-1',
        activeMcpServers: ['p360-rest'],
      },
      { useLooseMcpInputSchemaForOpenAi: true },
    )

    const res = await out.tools[0]!.execute!({ entity: 'Product2G' })
    expect(res.ok).toBe(true)
    expect(callToolMock).toHaveBeenCalledTimes(1)
  })
})
