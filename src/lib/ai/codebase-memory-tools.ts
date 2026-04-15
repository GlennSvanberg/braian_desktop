import { toolDefinition } from '@tanstack/ai'
import { z } from 'zod'

import { aiSettingsGet } from '@/lib/ai-settings-api'
import { isNonWorkspaceScopedSessionId } from '@/lib/chat-sessions/detached'
import { kindToDir } from '@/lib/memory/semantic-record'
import { SEMANTIC_MEMORY_ROOT } from '@/lib/memory/constants'
import { readSemanticMemoryRecord } from '@/lib/memory/semantic-store'
import { hybridWorkspaceSearch } from '@/lib/retrieval/hybrid-workspace-search'
import { isTauri } from '@/lib/tauri-env'

import type { ChatTurnContext } from './types'

const searchCodebaseIndexSchema = z.object({
  query: z.string().min(1).describe('Search string (regex line match in workspace files).'),
  fileGlob: z
    .string()
    .optional()
    .describe(
      'Optional file name filter (e.g. "*.ts"). Searches skip heavy dirs like node_modules.',
    ),
  maxResults: z.number().int().min(1).max(200).optional(),
})

const relatedFilesSchema = z.object({
  kind: z.enum(['fact', 'decision', 'preference', 'episode', 'pattern']),
  entryId: z.string().min(1),
})

const searchCodebaseIndexTool = toolDefinition({
  name: 'search_codebase_index',
  description: `Search workspace files (lexical + semantic when indexed), same hybrid engine as \`search_workspace\`. Prefer \`search_workspace\` in code mode for large refactors.`,
  inputSchema: searchCodebaseIndexSchema,
})

const getRelatedFilesForMemoryTool = toolDefinition({
  name: 'get_related_files_for_memory',
  description: `List **file paths** referenced in a structured memory entry (source refs of type file).`,
  inputSchema: relatedFilesSchema,
})

export function buildCodebaseMemoryTools(context: ChatTurnContext | undefined) {
  if (
    !isTauri() ||
    !context?.workspaceId ||
    isNonWorkspaceScopedSessionId(context.workspaceId)
  ) {
    return []
  }

  const workspaceId = context.workspaceId

  return [
    searchCodebaseIndexTool.server(async (args) => {
      const input = searchCodebaseIndexSchema.parse(args)
      const settings = await aiSettingsGet()
      const max = input.maxResults ?? 80
      const r = await hybridWorkspaceSearch({
        workspaceId,
        query: input.query,
        fileGlob: input.fileGlob ?? null,
        caseInsensitive: true,
        maxResults: max,
        settings,
      })
      return {
        ok: true as const,
        truncated: r.truncated,
        filesSearched: r.filesSearched,
        matches: r.matches.slice(0, max),
        semanticHits: r.semanticHits,
        mergedPreview: r.mergedPreview,
        semanticSkippedReason: r.semanticSkippedReason,
      }
    }),

    getRelatedFilesForMemoryTool.server(async (args) => {
      const input = relatedFilesSchema.parse(args)
      const dir = kindToDir(input.kind)
      const relPath = `${SEMANTIC_MEMORY_ROOT}/${dir}/${input.entryId}.json`
      const record = await readSemanticMemoryRecord(workspaceId, relPath)
      if (!record || record.id !== input.entryId) {
        return { ok: false as const, error: 'Memory entry not found.' }
      }
      const files = record.sourceRefs
        .filter((r): r is { type: 'file'; path: string } => r.type === 'file')
        .map((r) => r.path)
      return { ok: true as const, files, memoryPath: relPath }
    }),
  ]
}
