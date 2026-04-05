import { toolDefinition } from '@tanstack/ai'
import { z } from 'zod'

import { isNonWorkspaceScopedSessionId } from '@/lib/chat-sessions/detached'
import {
  workspaceMcpCallTool,
  workspaceMcpListTools,
} from '@/lib/mcp-runtime-api'
import { isTauri } from '@/lib/tauri-env'

import type { ChatTurnContext } from './types'

import type { Tool } from '@tanstack/ai'

const mcpToolArgsSchema = z
  .record(z.string(), z.unknown())
  .describe(
    'Arguments for this MCP tool as a JSON object; keys match the server tool schema when known.',
  )

function slugPart(raw: string, fallback: string): string {
  const s = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  const t = s.length > 0 ? s.slice(0, 48) : ''
  return t.length > 0 ? t : fallback
}

export type BuildMcpToolsResult = {
  tools: Tool[]
  /** Per-server list failures to show as settings-style warnings. */
  warnings: string[]
}

/**
 * Dynamic MCP tools from workspace Connections (stdio + remote), desktop only.
 */
export async function buildMcpTools(
  context: ChatTurnContext | undefined,
): Promise<BuildMcpToolsResult> {
  const warnings: string[] = []
  if (
    !context?.workspaceId ||
    isNonWorkspaceScopedSessionId(context.workspaceId) ||
    !isTauri()
  ) {
    return { tools: [], warnings }
  }

  let catalog: Awaited<ReturnType<typeof workspaceMcpListTools>>
  try {
    catalog = await workspaceMcpListTools(context.workspaceId)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    warnings.push(`Connections (MCP): could not list tools — ${msg}`)
    return { tools: [], warnings }
  }

  const usedNames = new Set<string>()
  const tools: Tool[] = []

  for (const server of catalog.servers) {
    if (server.error?.trim()) {
      warnings.push(
        `Connections: server "${server.name}" — ${server.error.trim()}`,
      )
    }
    const serverSlug = slugPart(server.name, 'server')
    const serverNote = server.description?.trim()
      ? ` Server note: ${server.description.trim()}`
      : ''

    for (const t of server.tools) {
      if (!t || typeof t !== 'object') continue
      const name = (t as { name?: string }).name
      if (typeof name !== 'string' || !name.trim()) continue
      const desc =
        typeof (t as { description?: string }).description === 'string'
          ? (t as { description: string }).description
          : ''
      const schemaRaw = (t as { inputSchema?: unknown }).inputSchema
      const schemaHint =
        schemaRaw != null
          ? ` inputSchema (JSON Schema excerpt): ${JSON.stringify(schemaRaw).slice(0, 1200)}`
          : ''

      let toolSlug = slugPart(name, 'tool')
      let tanstackName = `mcp__${serverSlug}__${toolSlug}`
      let n = 2
      while (usedNames.has(tanstackName)) {
        tanstackName = `mcp__${serverSlug}__${toolSlug}_${n}`
        n += 1
      }
      usedNames.add(tanstackName)

      const description = [
        `[MCP connection "${server.name}"] ${name}.`,
        serverNote,
        desc.trim() ? ` ${desc.trim()}` : '',
        schemaHint,
      ]
        .join('')
        .slice(0, 8000)

      const serverName = server.name
      const mcpToolName = name
      const def = toolDefinition({
        name: tanstackName,
        description,
        inputSchema: mcpToolArgsSchema,
      })

      tools.push(
        def.server(async (args) => {
          const input = mcpToolArgsSchema.parse(args)
          try {
            const text = await workspaceMcpCallTool({
              workspaceId: context.workspaceId!,
              serverName,
              toolName: mcpToolName,
              arguments: input,
            })
            return { ok: true as const, result: text }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            return { ok: false as const, error: msg }
          }
        }),
      )
    }
  }

  return { tools, warnings }
}
