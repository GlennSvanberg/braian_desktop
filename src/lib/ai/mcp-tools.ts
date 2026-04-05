import { toolDefinition } from '@tanstack/ai'
import { z } from 'zod'

import { isNonWorkspaceScopedSessionId } from '@/lib/chat-sessions/detached'
import {
  workspaceMcpCallTool,
  workspaceMcpListTools,
} from '@/lib/mcp-runtime-api'
import { isTauri } from '@/lib/tauri-env'

import type { ChatTurnContext } from './types'

import type { JSONSchema, Tool } from '@tanstack/ai'

const MCP_TOOL_CATALOG_TTL_MS = 15_000
const MCP_TOOL_LIST_TIMEOUT_MS = 4_000

type McpCatalog = Awaited<ReturnType<typeof workspaceMcpListTools>>

const mcpCatalogCache = new Map<
  string,
  {
    fetchedAt: number
    catalog: McpCatalog
  }
>()
const mcpCatalogInFlight = new Map<string, Promise<McpCatalog>>()

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

async function listMcpToolsCached(
  workspaceId: string,
): Promise<{ catalog: McpCatalog; warning?: string }> {
  const now = nowMs()
  const cached = mcpCatalogCache.get(workspaceId)
  if (cached && now - cached.fetchedAt <= MCP_TOOL_CATALOG_TTL_MS) {
    return { catalog: cached.catalog }
  }

  const inFlight = mcpCatalogInFlight.get(workspaceId)
  if (inFlight) {
    const catalog = await withTimeout(
      inFlight,
      MCP_TOOL_LIST_TIMEOUT_MS,
      'Connections (MCP) list-tools',
    )
    return { catalog }
  }

  const request = workspaceMcpListTools(workspaceId).then((catalog) => {
    mcpCatalogCache.set(workspaceId, { fetchedAt: nowMs(), catalog })
    return catalog
  })
  mcpCatalogInFlight.set(workspaceId, request)

  try {
    const catalog = await withTimeout(
      request,
      MCP_TOOL_LIST_TIMEOUT_MS,
      'Connections (MCP) list-tools',
    )
    return { catalog }
  } catch (error) {
    if (cached) {
      return {
        catalog: cached.catalog,
        warning:
          'Connections (MCP): list-tools is slow; using cached catalog from the previous turn.',
      }
    }
    throw error
  } finally {
    if (mcpCatalogInFlight.get(workspaceId) === request) {
      mcpCatalogInFlight.delete(workspaceId)
    }
  }
}

/**
 * OpenAI tool schemas reject `propertyNames` (emitted by `z.record` in Zod → JSON Schema).
 * `passthrough` yields `additionalProperties` only, which providers accept.
 * Used only when the MCP server does not supply a usable `inputSchema`.
 */
const mcpToolArgsSchema = z
  .object({})
  .passthrough()
  .describe(
    'Arguments for this MCP tool as a JSON object; keys match the server tool schema when known.',
  )

/**
 * Remove `propertyNames` recursively so provider JSON Schema validation accepts the tool.
 * MCP may emit draft features we still want to strip even when forwarding schemas.
 */
function stripPropertyNamesFromJsonSchema(node: unknown): unknown {
  if (node === null || typeof node !== 'object') return node
  if (Array.isArray(node)) {
    return node.map(stripPropertyNamesFromJsonSchema)
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (k === 'propertyNames') continue
    out[k] = stripPropertyNamesFromJsonSchema(v)
  }
  return out
}

/**
 * When present, forward the MCP tool's JSON Schema to the LLM so `required` and property
 * types are visible (avoids empty `{}` tool calls). Falls back to passthrough when unusable.
 */
function mcpInputSchemaForProvider(raw: unknown): JSONSchema | undefined {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined
  }
  let cloned: unknown
  try {
    cloned = JSON.parse(JSON.stringify(raw))
  } catch {
    return undefined
  }
  const stripped = stripPropertyNamesFromJsonSchema(cloned)
  if (
    stripped === null ||
    typeof stripped !== 'object' ||
    Array.isArray(stripped)
  ) {
    return undefined
  }
  const schema = stripped as Record<string, unknown> & JSONSchema

  // Unresolved refs do not round-trip reliably to the model; keep Zod fallback + description.
  if (
    typeof schema.$ref === 'string' &&
    schema.$ref.length > 0 &&
    schema.properties == null
  ) {
    return undefined
  }

  if (schema.type === 'object' || schema.properties != null) {
    if (!schema.type) schema.type = 'object'
    if (!schema.properties) schema.properties = {}
    if (!Array.isArray(schema.required)) schema.required = []
    return schema as JSONSchema
  }

  if (Object.keys(schema).length === 0) return undefined
  return schema as JSONSchema
}

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
  /** Human-readable names of MCP servers that contributed tools. */
  serverNames: string[]
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
    return { tools: [], warnings, serverNames: [] }
  }

  let catalog: McpCatalog
  try {
    const listed = await listMcpToolsCached(context.workspaceId)
    catalog = listed.catalog
    if (listed.warning) {
      warnings.push(listed.warning)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    warnings.push(`Connections (MCP): could not list tools — ${msg}`)
    return { tools: [], warnings, serverNames: [] }
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
      const providerSchema = mcpInputSchemaForProvider(schemaRaw)
      const schemaHint =
        providerSchema == null && schemaRaw != null
          ? ` inputSchema (not forwarded; excerpt): ${JSON.stringify(schemaRaw).slice(0, 900)}`
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
        inputSchema: providerSchema ?? mcpToolArgsSchema,
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

  const serverNames = catalog.servers
    .filter((s) => s.tools.length > 0 && !s.error?.trim())
    .map((s) => s.name)

  return { tools, warnings, serverNames }
}
