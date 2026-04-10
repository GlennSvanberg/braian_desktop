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

import type { JSONSchema, Tool } from '@tanstack/ai'

/** Reuse catalog across turns while sessions may still be warm (see idle disconnect in mcp-runtime-api). */
const MCP_TOOL_CATALOG_TTL_MS = 60_000

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
 * OpenAI function parameters reject object schemas that declare `properties` but omit
 * `additionalProperties: false` (including under `items`, `oneOf`, etc.). MCP servers
 * often emit draft/loose JSON Schema; normalize recursively before sending tools.
 */
function ensureAdditionalPropertiesFalseForOpenAi(node: unknown): unknown {
  if (node === null || typeof node !== 'object') return node
  if (Array.isArray(node)) {
    return node.map(ensureAdditionalPropertiesFalseForOpenAi)
  }

  const o = node as Record<string, unknown>
  const out: Record<string, unknown> = {}

  for (const [key, val] of Object.entries(o)) {
    switch (key) {
      case 'properties':
      case 'patternProperties':
        if (val && typeof val === 'object' && !Array.isArray(val)) {
          const mapped: Record<string, unknown> = {}
          for (const [pk, pv] of Object.entries(val)) {
            mapped[pk] = ensureAdditionalPropertiesFalseForOpenAi(pv)
          }
          out[key] = mapped
        } else {
          out[key] = val
        }
        break
      case 'items':
        if (Array.isArray(val)) {
          out[key] = val.map(ensureAdditionalPropertiesFalseForOpenAi)
        } else {
          out[key] = ensureAdditionalPropertiesFalseForOpenAi(val)
        }
        break
      case 'prefixItems':
        out[key] = Array.isArray(val)
          ? val.map(ensureAdditionalPropertiesFalseForOpenAi)
          : val
        break
      case 'additionalProperties':
        if (typeof val === 'boolean') {
          out[key] = val
        } else {
          out[key] = ensureAdditionalPropertiesFalseForOpenAi(val)
        }
        break
      case 'oneOf':
      case 'anyOf':
      case 'allOf':
        out[key] = Array.isArray(val)
          ? val.map(ensureAdditionalPropertiesFalseForOpenAi)
          : val
        break
      case 'not':
      case 'if':
      case 'then':
      case 'else':
        out[key] = ensureAdditionalPropertiesFalseForOpenAi(val)
        break
      case 'definitions':
      case '$defs':
        if (val && typeof val === 'object' && !Array.isArray(val)) {
          const mapped: Record<string, unknown> = {}
          for (const [dk, dv] of Object.entries(val)) {
            mapped[dk] = ensureAdditionalPropertiesFalseForOpenAi(dv)
          }
          out[key] = mapped
        } else {
          out[key] = val
        }
        break
      default:
        out[key] = val
    }
  }

  const props = out.properties
  const hasProperties =
    props != null && typeof props === 'object' && !Array.isArray(props)

  // OpenAI requires `additionalProperties: false` on every object that declares
  // `properties`. Do not gate on `type === 'object'` only — MCP / JSON Schema
  // often uses `type: ['object', 'null']` (or omits `type`), which would skip
  // the flag and reproduce: "context=('properties', 'rows', 'items')".
  if (hasProperties) {
    out.additionalProperties = false
    if (out.type === undefined) {
      out.type = 'object'
    }
  } else {
    const t = out.type
    const objectish =
      t === 'object' ||
      (Array.isArray(t) && (t as unknown[]).includes('object'))
    if (objectish && !('additionalProperties' in out)) {
      out.additionalProperties = false
    }
  }

  return out
}

/**
 * Deep-clone and normalize MCP `inputSchema` JSON when forwarding to providers
 * (e.g. Anthropic). OpenAI / OpenAI-compatible: use `useLooseMcpInputSchemaForOpenAi`
 * in `buildMcpTools` instead of forwarding.
 */
export function normalizeMcpToolInputJsonSchemaForOpenAi(raw: unknown): unknown {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return raw
  }
  try {
    const cloned = JSON.parse(JSON.stringify(raw))
    const stripped = stripPropertyNamesFromJsonSchema(cloned)
    return ensureAdditionalPropertiesFalseForOpenAi(stripped)
  } catch {
    return raw
  }
}

/**
 * When present, forward the MCP tool's JSON Schema to the LLM so `required` and property
 * types are visible (avoids empty `{}` tool calls). Falls back to passthrough when unusable.
 */
function mcpInputSchemaForProvider(raw: unknown): JSONSchema | undefined {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined
  }
  const stripped = normalizeMcpToolInputJsonSchemaForOpenAi(raw)
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

type AjvValidateFn = ReturnType<typeof ajv.compile>

function requiredTopLevelKeysFromSchema(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
  const obj = raw as Record<string, unknown>
  const req = obj.required
  if (!Array.isArray(req)) return []
  return req.filter((k): k is string => typeof k === 'string' && k.length > 0)
}

function topLevelRequiredStringShapeSchema(raw: unknown): z.ZodObject<Record<string, z.ZodString>> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const obj = raw as Record<string, unknown>
  const required = requiredTopLevelKeysFromSchema(raw)
  if (required.length === 0) return undefined
  const properties =
    obj.properties && typeof obj.properties === 'object' && !Array.isArray(obj.properties)
      ? (obj.properties as Record<string, unknown>)
      : {}

  const shape: Record<string, z.ZodString> = {}
  for (const key of required) {
    const prop = properties[key]
    if (!prop || typeof prop !== 'object' || Array.isArray(prop)) {
      return undefined
    }
    const p = prop as Record<string, unknown>
    if (p.type !== 'string') {
      return undefined
    }
    shape[key] = z.string()
  }
  return z.object(shape)
}

function compileMcpArgsValidator(rawSchema: unknown): {
  validate: AjvValidateFn | null
  requiredKeys: string[]
} {
  if (!rawSchema || typeof rawSchema !== 'object' || Array.isArray(rawSchema)) {
    return { validate: null, requiredKeys: [] }
  }
  const schema = normalizeMcpToolInputJsonSchemaForOpenAi(rawSchema)
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return { validate: null, requiredKeys: [] }
  }
  try {
    const validate = ajv.compile(schema as Record<string, unknown>)
    return {
      validate,
      requiredKeys: requiredTopLevelKeysFromSchema(schema),
    }
  } catch {
    return { validate: null, requiredKeys: requiredTopLevelKeysFromSchema(schema) }
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

export type BuildMcpToolsOptions = {
  /**
   * OpenAI tool `strict` mode + TanStack’s schema pass cannot represent many
   * real-world MCP JSON Schemas (nested `rows.items`, nullable unions, etc.).
   * When true, register MCP tools with a loose object schema and put a truncated
   * JSON Schema excerpt in the description so the model still sees arg shape.
   */
  useLooseMcpInputSchemaForOpenAi?: boolean
}

/**
 * Dynamic MCP tools from workspace Connections (stdio + remote), desktop only.
 */
export async function buildMcpTools(
  context: ChatTurnContext | undefined,
  options?: BuildMcpToolsOptions,
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
  const useLooseForOpenAi = options?.useLooseMcpInputSchemaForOpenAi === true

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
      const { validate: validateArgs, requiredKeys } =
        compileMcpArgsValidator(schemaRaw)
      const providerSchema = useLooseForOpenAi
        ? undefined
        : mcpInputSchemaForProvider(schemaRaw)
      const openAiRequiredShape =
        useLooseForOpenAi && providerSchema == null
          ? topLevelRequiredStringShapeSchema(schemaRaw)
          : undefined
      const schemaHint =
        schemaRaw != null && (providerSchema == null || useLooseForOpenAi)
          ? ` inputSchema (excerpt — call with a JSON object matching this shape): ${JSON.stringify(schemaRaw).slice(0, 900)}`
          : ''
      const requiredKeysHint =
        requiredKeys.length > 0
          ? ` Required top-level keys: ${requiredKeys.join(', ')}.`
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
        requiredKeysHint,
        schemaHint,
      ]
        .join('')
        .slice(0, 8000)

      const serverName = server.name
      const mcpToolName = name
      const def = toolDefinition({
        name: tanstackName,
        description,
        inputSchema: providerSchema ?? openAiRequiredShape ?? mcpToolArgsSchema,
      })

      tools.push(
        def.server(async (args) => {
          const input = mcpToolArgsSchema.parse(args)
          if (validateArgs && !validateArgs(input)) {
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
