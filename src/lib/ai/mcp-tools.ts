import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import { toolDefinition } from '@tanstack/ai'
import { z } from 'zod'

import { isNonWorkspaceScopedSessionId } from '@/lib/chat-sessions/detached'
import {
  workspaceMcpCallTool,
  workspaceMcpListTimeoutMs,
  workspaceMcpListTools,
} from '@/lib/mcp-runtime-api'
import { isTauri } from '@/lib/tauri-env'

import type { ChatTurnContext } from './types'

import type { Tool } from '@tanstack/ai'

/** Reuse catalog across turns while sessions may still be warm (see idle disconnect in mcp-runtime-api). */
const MCP_TOOL_CATALOG_TTL_MS = 60_000

/** Max length for tool description text sent to the model (per tool). */
const MCP_TOOL_DESCRIPTION_MAX_CHARS = 8000

type McpCatalog = Awaited<ReturnType<typeof workspaceMcpListTools>>

const mcpCatalogCache = new Map<
  string,
  {
    fetchedAt: number
    catalog: McpCatalog
  }
>()
const mcpCatalogInFlight = new Map<string, Promise<McpCatalog>>()
const mcpListTimeoutMsCache = new Map<
  string,
  { fetchedAtMs: number; timeoutMs: number }
>()

const ajv = new Ajv({
  allErrors: true,
  strict: false,
  validateFormats: true,
})
addFormats(ajv)

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

async function mcpListTimeoutMsForWorkspace(workspaceId: string): Promise<number> {
  const cached = mcpListTimeoutMsCache.get(workspaceId)
  const now = nowMs()
  if (cached && now - cached.fetchedAtMs <= MCP_TOOL_CATALOG_TTL_MS) {
    return cached.timeoutMs
  }
  try {
    const timeoutMs = await workspaceMcpListTimeoutMs(workspaceId)
    mcpListTimeoutMsCache.set(workspaceId, { fetchedAtMs: now, timeoutMs })
    return timeoutMs
  } catch {
    return 30_000
  }
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
  activeServerNames: string[],
): Promise<{ catalog: McpCatalog; warning?: string }> {
  const listTimeoutMs = await mcpListTimeoutMsForWorkspace(workspaceId)
  const scopeKey = `${workspaceId}::${activeServerNames.join('|')}`
  const now = nowMs()
  const cached = mcpCatalogCache.get(scopeKey)
  if (cached && now - cached.fetchedAt <= MCP_TOOL_CATALOG_TTL_MS) {
    return { catalog: cached.catalog }
  }

  const inFlight = mcpCatalogInFlight.get(scopeKey)
  if (inFlight) {
    const catalog = await withTimeout(
      inFlight,
      listTimeoutMs,
      'Connections (MCP) list-tools',
    )
    return { catalog }
  }

  const request = workspaceMcpListTools(workspaceId, activeServerNames).then(
    (catalog) => {
      mcpCatalogCache.set(scopeKey, { fetchedAt: nowMs(), catalog })
      return catalog
    },
  )
  mcpCatalogInFlight.set(scopeKey, request)

  try {
    const catalog = await withTimeout(
      request,
      listTimeoutMs,
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
    if (mcpCatalogInFlight.get(scopeKey) === request) {
      mcpCatalogInFlight.delete(scopeKey)
    }
  }
}

/**
 * Remove `propertyNames` recursively so Ajv / tooling can accept the schema.
 * MCP may emit draft features OpenAI rejects when forwarding full schemas.
 */
export function stripPropertyNamesFromJsonSchema(node: unknown): unknown {
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
 * Single stable shape for every MCP tool sent to the LLM provider (avoids
 * OpenAI `invalid_function_parameters` on complex nested JSON Schemas).
 */
export const mcpDynamicToolInputSchema = z.object({
  argumentsJson: z
    .string()
    .describe(
      'Use JSON.stringify on the MCP tool argument object so this field is a JSON string that parses to a plain object (not an array). Include every required key listed in the tool description.',
    ),
})

type AjvValidateFn = ReturnType<typeof ajv.compile>

function requiredTopLevelKeysFromSchema(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
  const obj = raw as Record<string, unknown>
  const req = obj.required
  if (!Array.isArray(req)) return []
  return req.filter((k): k is string => typeof k === 'string' && k.length > 0)
}

function optionalTopLevelKeysFromSchema(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
  const obj = raw as Record<string, unknown>
  const props = obj.properties
  if (!props || typeof props !== 'object' || Array.isArray(props)) return []
  const keys = Object.keys(props as Record<string, unknown>)
  const required = new Set(requiredTopLevelKeysFromSchema(raw))
  return keys.filter((k) => !required.has(k))
}

function compileMcpArgsValidator(
  rawSchema: unknown,
  warnings: string[],
  serverName: string,
  toolName: string,
): {
  validate: AjvValidateFn | null
  requiredKeys: string[]
} {
  const requiredKeys = requiredTopLevelKeysFromSchema(rawSchema)
  if (!rawSchema || typeof rawSchema !== 'object' || Array.isArray(rawSchema)) {
    return { validate: null, requiredKeys: [] }
  }
  let stripped: unknown
  try {
    stripped = stripPropertyNamesFromJsonSchema(
      JSON.parse(JSON.stringify(rawSchema)),
    )
  } catch {
    warnings.push(
      `Connections (MCP): could not clone argument schema for "${serverName}" / "${toolName}" — arguments are sent to the server without client-side JSON Schema validation.`,
    )
    return { validate: null, requiredKeys }
  }
  try {
    const validate = ajv.compile(stripped as Record<string, unknown>)
    return { validate, requiredKeys }
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    warnings.push(
      `Connections (MCP): could not compile argument validator for "${serverName}" / "${toolName}" — arguments are sent to the server without client-side JSON Schema validation. (${detail})`,
    )
    return { validate: null, requiredKeys }
  }
}

function buildValidationErrorMessage(
  toolName: string,
  requiredKeys: string[],
  errors: AjvValidateFn['errors'],
): string {
  const missing = new Set<string>()
  for (const err of errors ?? []) {
    if (err.keyword === 'required' && typeof err.params === 'object' && err.params != null) {
      const missingProperty = (err.params as { missingProperty?: unknown }).missingProperty
      if (typeof missingProperty === 'string' && missingProperty.length > 0) {
        missing.add(missingProperty)
      }
    }
  }
  const orderedMissing = [...missing]
  if (orderedMissing.length > 0) {
    return `Invalid arguments for MCP tool "${toolName}". Missing required keys: ${orderedMissing.join(', ')}.`
  }
  if (requiredKeys.length > 0) {
    return `Invalid arguments for MCP tool "${toolName}". Required top-level keys: ${requiredKeys.join(', ')}.`
  }
  const first = errors?.[0]?.message?.trim()
  return first
    ? `Invalid arguments for MCP tool "${toolName}": ${first}.`
    : `Invalid arguments for MCP tool "${toolName}".`
}

function buildMcpToolDescription(opts: {
  serverName: string
  toolName: string
  serverNote: string
  toolDescription: string
  schemaRaw: unknown
  requiredKeys: string[]
  optionalKeys: string[]
}): string {
  const howToCall =
    'How to call: pass tool arguments as a JSON object with a single key "argumentsJson" whose value is a JSON **string** containing the full argument object the MCP server expects (same keys as in inputSchema below). After parsing, that string must be a JSON object (not an array). Example value for argumentsJson: "{\\"entity\\":\\"Product\\"}".'

  const reqPart =
    opts.requiredKeys.length > 0
      ? `Top-level keys (required): ${opts.requiredKeys.join(', ')}.`
      : 'Top-level keys (required): (none listed in schema).'
  const optPart =
    opts.optionalKeys.length > 0
      ? ` Top-level keys (optional): ${opts.optionalKeys.join(', ')}.`
      : ''

  const header = [
    `[MCP connection "${opts.serverName}"] ${opts.toolName}.`,
    opts.serverNote,
    opts.toolDescription.trim() ? ` ${opts.toolDescription.trim()}` : '',
    '',
    howToCall,
    '',
    reqPart + optPart,
    '',
    'inputSchema reference (truncated JSON): ',
  ].join('')

  const budget = Math.max(0, MCP_TOOL_DESCRIPTION_MAX_CHARS - header.length)
  const schemaStr =
    opts.schemaRaw != null ? JSON.stringify(opts.schemaRaw) : '(no inputSchema from server)'
  const excerpt = budget > 0 ? schemaStr.slice(0, budget) : ''
  return (header + excerpt).slice(0, MCP_TOOL_DESCRIPTION_MAX_CHARS)
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
  const activeServerNames = Array.from(
    new Set((context.activeMcpServers ?? []).map((s) => s.trim()).filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b))
  if (activeServerNames.length === 0) {
    return { tools: [], warnings, serverNames: [] }
  }

  let catalog: McpCatalog
  try {
    const listed = await listMcpToolsCached(context.workspaceId, activeServerNames)
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
      const optionalKeys = optionalTopLevelKeysFromSchema(schemaRaw)
      const { validate: validateArgs, requiredKeys } = compileMcpArgsValidator(
        schemaRaw,
        warnings,
        server.name,
        name,
      )

      const description = buildMcpToolDescription({
        serverName: server.name,
        toolName: name,
        serverNote,
        toolDescription: desc,
        schemaRaw,
        requiredKeys,
        optionalKeys,
      })

      let toolSlug = slugPart(name, 'tool')
      let tanstackName = `mcp__${serverSlug}__${toolSlug}`
      let n = 2
      while (usedNames.has(tanstackName)) {
        tanstackName = `mcp__${serverSlug}__${toolSlug}_${n}`
        n += 1
      }
      usedNames.add(tanstackName)

      const serverName = server.name
      const mcpToolName = name
      const def = toolDefinition({
        name: tanstackName,
        description,
        inputSchema: mcpDynamicToolInputSchema,
      })

      tools.push(
        def.server(async (args) => {
          const input = mcpDynamicToolInputSchema.parse(args)
          let parsedArgs: Record<string, unknown>
          try {
            const inner = JSON.parse(input.argumentsJson) as unknown
            if (
              inner === null ||
              typeof inner !== 'object' ||
              Array.isArray(inner)
            ) {
              return {
                ok: false as const,
                error: `Invalid arguments for MCP tool "${mcpToolName}": argumentsJson must parse to a JSON object (not an array or primitive).`,
              }
            }
            parsedArgs = inner as Record<string, unknown>
          } catch {
            return {
              ok: false as const,
              error: `Invalid arguments for MCP tool "${mcpToolName}": argumentsJson is not valid JSON.`,
            }
          }
          if (validateArgs && !validateArgs(parsedArgs)) {
            return {
              ok: false as const,
              error: buildValidationErrorMessage(
                mcpToolName,
                requiredKeys,
                validateArgs.errors,
              ),
            }
          }
          try {
            const text = await workspaceMcpCallTool({
              workspaceId: context.workspaceId!,
              serverName,
              toolName: mcpToolName,
              arguments: parsedArgs,
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
