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

describe('MCP tool AJV argument validation (argumentsJson bridge)', () => {
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

    const out = await buildMcpTools({
      workspaceId: 'ws-1',
      conversationId: 'c-1',
      activeMcpServers: ['p360-rest'],
    })

    const execute = out.tools[0]?.execute
    expect(execute).toBeTypeOf('function')
    const res = await execute!({
      argumentsJson: JSON.stringify({}),
    })
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

    const out = await buildMcpTools({
      workspaceId: 'ws-1',
      conversationId: 'c-1',
      activeMcpServers: ['p360-rest'],
    })

    const res = await out.tools[0]!.execute!({
      argumentsJson: JSON.stringify({ entity: 'Product2G' }),
    })
    expect(res.ok).toBe(true)
    expect(callToolMock).toHaveBeenCalledTimes(1)
    expect(callToolMock).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      serverName: 'p360-rest',
      toolName: 'get_entity_fields_grouped',
      arguments: { entity: 'Product2G' },
    })
  })

  it('fails fast when required keys include a non-string type (e.g. ids array)', async () => {
    listToolsMock.mockResolvedValueOnce({
      servers: [
        {
          name: 'azure_devops',
          tools: [
            {
              name: 'wit_get_work_items_batch_by_ids',
              description: 'Batch get',
              inputSchema: {
                type: 'object',
                required: ['project', 'ids'],
                properties: {
                  project: { type: 'string' },
                  ids: {
                    type: 'array',
                    items: { type: 'integer' },
                  },
                },
              },
            },
          ],
        },
      ],
    })

    const out = await buildMcpTools({
      workspaceId: 'ws-1',
      conversationId: 'c-1',
      activeMcpServers: ['azure_devops'],
    })

    const res = await out.tools[0]!.execute!({
      argumentsJson: JSON.stringify({}),
    })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/project/)
    expect(res.error).toMatch(/ids/)
    expect(callToolMock).not.toHaveBeenCalled()
  })

  it('rejects invalid JSON in argumentsJson', async () => {
    listToolsMock.mockResolvedValueOnce({
      servers: [
        {
          name: 'p360-rest',
          tools: [
            {
              name: 't1',
              inputSchema: { type: 'object', properties: {} },
            },
          ],
        },
      ],
    })
    const out = await buildMcpTools({
      workspaceId: 'ws-1',
      conversationId: 'c-1',
      activeMcpServers: ['p360-rest'],
    })
    const res = await out.tools[0]!.execute!({
      argumentsJson: 'not-json{',
    })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/not valid JSON/)
    expect(callToolMock).not.toHaveBeenCalled()
  })

  it('rejects when argumentsJson parses to a non-object', async () => {
    listToolsMock.mockResolvedValueOnce({
      servers: [
        {
          name: 'p360-rest',
          tools: [
            {
              name: 't1',
              inputSchema: { type: 'object', properties: {} },
            },
          ],
        },
      ],
    })
    const out = await buildMcpTools({
      workspaceId: 'ws-1',
      conversationId: 'c-1',
      activeMcpServers: ['p360-rest'],
    })
    const res = await out.tools[0]!.execute!({
      argumentsJson: JSON.stringify([1, 2]),
    })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/JSON object/)
    expect(callToolMock).not.toHaveBeenCalled()
  })

  it('adds a warning and forwards args when Ajv cannot compile the schema', async () => {
    callToolMock.mockResolvedValueOnce('ok-from-server')
    listToolsMock.mockResolvedValueOnce({
      servers: [
        {
          name: 'bad-schema',
          tools: [
            {
              name: 'uncompilable',
              inputSchema: { type: 1 } as unknown,
            },
          ],
        },
      ],
    })
    const out = await buildMcpTools({
      workspaceId: 'ws-1',
      conversationId: 'c-1',
      activeMcpServers: ['bad-schema'],
    })
    expect(out.warnings.some((w) => w.includes('could not compile argument validator'))).toBe(
      true,
    )
    const res = await out.tools[0]!.execute!({
      argumentsJson: JSON.stringify({ foo: 'bar' }),
    })
    expect(res.ok).toBe(true)
    expect(callToolMock).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      serverName: 'bad-schema',
      toolName: 'uncompilable',
      arguments: { foo: 'bar' },
    })
  })
})
