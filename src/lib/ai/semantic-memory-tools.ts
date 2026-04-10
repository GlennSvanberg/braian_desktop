import { toolDefinition } from '@tanstack/ai'
import { z } from 'zod'

import { isNonWorkspaceScopedSessionId } from '@/lib/chat-sessions/detached'
import { SEMANTIC_MEMORY_ROOT } from '@/lib/memory/constants'
import {
  archiveMemoryEntry,
  markMemoryStale,
  validateMemoryEntry,
} from '@/lib/memory/memory-entry-operations'
import {
  isSemanticEntryExcludedFromSearch,
  matchesWorkspaceMemoryQuery,
} from '@/lib/memory/semantic-memory-search'
import { kindToDir } from '@/lib/memory/semantic-record'
import {
  loadAllSemanticRecords,
  readSemanticMemoryRecord,
  rememberWorkspaceMemoryEntry,
} from '@/lib/memory/semantic-store'

import type { ChatTurnContext } from './types'

const memoryKindFilter = z
  .enum(['fact', 'decision', 'preference', 'episode', 'pattern'])
  .optional()
  .describe('When set, only return entries of this kind.')

const searchWorkspaceMemorySchema = z.object({
  query: z
    .string()
    .min(1)
    .describe('Keywords to match against summary, text, tags, or id (case-insensitive).'),
  kind: memoryKindFilter,
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe('Max entries to return (default 20).'),
})

const openMemoryEntrySchema = z.object({
  kind: z.enum(['fact', 'decision', 'preference', 'episode', 'pattern']),
  entryId: z
    .string()
    .min(1)
    .describe('Memory entry id (e.g. mem_…), same as the JSON filename without .json.'),
})

const rememberFactSchema = z.object({
  text: z.string().min(1).describe('Fact to remember for this workspace.'),
  summary: z.string().optional().describe('One-line summary; defaults from text.'),
  tags: z.array(z.string()).optional(),
  confidence: z.number().min(0).max(1).optional(),
})

const rememberPreferenceSchema = z.object({
  text: z.string().min(1).describe('Preference to remember for this workspace.'),
  summary: z.string().optional(),
  tags: z.array(z.string()).optional(),
  confidence: z.number().min(0).max(1).optional(),
})

const entryRefSchema = z.object({
  kind: z.enum(['fact', 'decision', 'preference', 'episode', 'pattern']),
  entryId: z.string().min(1),
})

const searchWorkspaceMemoryTool = toolDefinition({
  name: 'search_workspace_memory',
  description: `Search **structured workspace memory** (JSON under \`${SEMANTIC_MEMORY_ROOT}/\`). Use to recall facts, decisions, preferences, episodes, or patterns saved for this workspace.`,
  inputSchema: searchWorkspaceMemorySchema,
})

const openMemoryEntryTool = toolDefinition({
  name: 'open_memory_entry',
  description: `Load one structured memory record by kind and id (full JSON body).`,
  inputSchema: openMemoryEntrySchema,
})

const rememberWorkspaceFactTool = toolDefinition({
  name: 'remember_workspace_fact',
  description: `Save a durable **fact** for this workspace as structured JSON (not only markdown). Use when the user asks to remember something factual about the project.`,
  inputSchema: rememberFactSchema,
})

const rememberWorkspacePreferenceTool = toolDefinition({
  name: 'remember_workspace_preference',
  description: `Save a **preference** (style, tone, tooling) for this workspace as structured JSON.`,
  inputSchema: rememberPreferenceSchema,
})

const forgetMemoryEntryTool = toolDefinition({
  name: 'forget_memory_entry',
  description: `Mark a structured memory entry as **archived** (soft delete).`,
  inputSchema: entryRefSchema,
})

const markMemoryStaleTool = toolDefinition({
  name: 'mark_memory_stale',
  description: `Mark a structured memory entry as **stale** for later review.`,
  inputSchema: entryRefSchema,
})

const validateMemoryEntryTool = toolDefinition({
  name: 'validate_memory_entry',
  description: `Mark a structured memory entry as **active** and set last validated time (user confirmed it is still correct).`,
  inputSchema: entryRefSchema,
})

export function buildSemanticMemoryTools(context: ChatTurnContext | undefined) {
  if (
    !context?.workspaceId ||
    isNonWorkspaceScopedSessionId(context.workspaceId)
  ) {
    return []
  }

  const workspaceId = context.workspaceId
  const conversationId = context.conversationId

  return [
    searchWorkspaceMemoryTool.server(async (args) => {
      const input = searchWorkspaceMemorySchema.parse(args)
      const max = input.maxResults ?? 20
      const q = input.query.trim()
      const rows = await loadAllSemanticRecords(workspaceId)
      const filtered = rows.filter(({ record }) => {
        if (input.kind && record.kind !== input.kind) return false
        if (isSemanticEntryExcludedFromSearch(record)) return false
        return matchesWorkspaceMemoryQuery(record, q)
      })
      const hits = filtered.slice(0, max).map(({ record, relativePath }) => ({
        id: record.id,
        kind: record.kind,
        summary: record.summary,
        status: record.status,
        relativePath,
      }))
      return { ok: true as const, matchCount: hits.length, hits }
    }),

    openMemoryEntryTool.server(async (args) => {
      const input = openMemoryEntrySchema.parse(args)
      const dir = kindToDir(input.kind)
      const relPath = `${SEMANTIC_MEMORY_ROOT}/${dir}/${input.entryId}.json`
      const record = await readSemanticMemoryRecord(workspaceId, relPath)
      if (!record || record.id !== input.entryId) {
        return {
          ok: false as const,
          error: `No memory entry at ${relPath}.`,
        }
      }
      return { ok: true as const, relativePath: relPath, record }
    }),

    rememberWorkspaceFactTool.server(async (args) => {
      const input = rememberFactSchema.parse(args)
      const r = await rememberWorkspaceMemoryEntry(workspaceId, {
        kind: 'fact',
        text: input.text,
        summary: input.summary,
        tags: input.tags,
        confidence: input.confidence,
        conversationId,
      })
      if (!r.ok) return r
      return {
        ok: true as const,
        id: r.id,
        relativePath: r.relativePath,
        message: 'Saved structured fact.',
      }
    }),

    rememberWorkspacePreferenceTool.server(async (args) => {
      const input = rememberPreferenceSchema.parse(args)
      const r = await rememberWorkspaceMemoryEntry(workspaceId, {
        kind: 'preference',
        text: input.text,
        summary: input.summary,
        tags: input.tags,
        confidence: input.confidence,
        conversationId,
      })
      if (!r.ok) return r
      return {
        ok: true as const,
        id: r.id,
        relativePath: r.relativePath,
        message: 'Saved structured preference.',
      }
    }),

    forgetMemoryEntryTool.server(async (args) => {
      const input = entryRefSchema.parse(args)
      const r = await archiveMemoryEntry(workspaceId, {
        kind: input.kind,
        entryId: input.entryId,
      })
      if (!r.ok) return { ok: false as const, error: r.error }
      return { ok: true as const, message: 'Entry archived.' }
    }),

    markMemoryStaleTool.server(async (args) => {
      const input = entryRefSchema.parse(args)
      const r = await markMemoryStale(workspaceId, {
        kind: input.kind,
        entryId: input.entryId,
      })
      if (!r.ok) return { ok: false as const, error: r.error }
      return { ok: true as const, message: 'Marked stale.' }
    }),

    validateMemoryEntryTool.server(async (args) => {
      const input = entryRefSchema.parse(args)
      const r = await validateMemoryEntry(workspaceId, {
        kind: input.kind,
        entryId: input.entryId,
      })
      if (!r.ok) return { ok: false as const, error: r.error }
      return { ok: true as const, message: 'Validated and marked active.' }
    }),
  ]
}
