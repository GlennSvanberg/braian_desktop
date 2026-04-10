import { z } from 'zod'

import { SEMANTIC_MEMORY_SUGGESTIONS_DIR } from '@/lib/memory/constants'
import { newMemoryId } from '@/lib/memory/semantic-record'
import { createWorkspaceMemoryEntry } from '@/lib/memory/semantic-store'
import {
  workspaceListDir,
  workspaceReadTextFile,
  workspaceWriteTextFile,
} from '@/lib/workspace-api'
import { isTauri } from '@/lib/tauri-env'

const suggestionFileSchemaV1 = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  status: z.enum(['pending', 'accepted', 'dismissed']),
  proposedKind: z.enum([
    'fact',
    'decision',
    'preference',
    'episode',
    'pattern',
  ]),
  candidateText: z.string(),
  confidence: z.number().min(0).max(1),
  sourceConversationId: z.string().optional(),
  createdAt: z.string(),
  /** Set when status is `accepted`. */
  promotedToMemoryId: z.string().optional(),
})

export type MemorySuggestionFileV1 = z.infer<typeof suggestionFileSchemaV1>

export function parseMemorySuggestionJson(
  raw: string,
): MemorySuggestionFileV1 | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    const r = suggestionFileSchemaV1.safeParse(parsed)
    return r.success ? r.data : null
  } catch {
    return null
  }
}

/** Queue a memory promotion candidate for user review (no auto-activation). */
export async function writeMemorySuggestion(
  workspaceId: string,
  input: {
    proposedKind: MemorySuggestionFileV1['proposedKind']
    candidateText: string
    confidence: number
    sourceConversationId?: string | null
  },
): Promise<{ ok: true; id: string; relativePath: string } | { ok: false; error: string }> {
  if (!isTauri()) {
    return { ok: false, error: 'Suggestions require the desktop app.' }
  }
  const id = newMemoryId()
  const rel = `${SEMANTIC_MEMORY_SUGGESTIONS_DIR}/${id}.json`
  const data: MemorySuggestionFileV1 = {
    schemaVersion: 1,
    id,
    status: 'pending',
    proposedKind: input.proposedKind,
    candidateText: input.candidateText.trim(),
    confidence: Math.min(1, Math.max(0, input.confidence)),
    sourceConversationId: input.sourceConversationId?.trim() || undefined,
    createdAt: new Date().toISOString(),
  }
  try {
    await workspaceWriteTextFile(
      workspaceId,
      rel,
      `${JSON.stringify(data, null, 2)}\n`,
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg }
  }
  return { ok: true, id, relativePath: rel }
}

const SUGGESTION_READ_MAX = 256 * 1024

/** List `.json` paths under the suggestions directory (flat). */
export async function listMemorySuggestionPaths(
  workspaceId: string,
): Promise<string[]> {
  if (!isTauri()) return []
  let entries: Awaited<ReturnType<typeof workspaceListDir>>
  try {
    entries = await workspaceListDir(workspaceId, SEMANTIC_MEMORY_SUGGESTIONS_DIR)
  } catch {
    return []
  }
  return entries
    .filter((e) => !e.isDir && e.name.endsWith('.json'))
    .map((e) => e.relativePath.replace(/\\/g, '/'))
}

export async function readMemorySuggestionFile(
  workspaceId: string,
  relativePath: string,
): Promise<MemorySuggestionFileV1 | null> {
  if (!isTauri()) return null
  try {
    const { text } = await workspaceReadTextFile(
      workspaceId,
      relativePath,
      SUGGESTION_READ_MAX,
    )
    return parseMemorySuggestionJson(text)
  } catch {
    return null
  }
}

export type PendingMemorySuggestionRow = {
  relativePath: string
  suggestion: MemorySuggestionFileV1
}

/** Pending suggestions only, newest first by `createdAt`. */
export async function listPendingMemorySuggestions(
  workspaceId: string,
): Promise<PendingMemorySuggestionRow[]> {
  const paths = await listMemorySuggestionPaths(workspaceId)
  const rows: PendingMemorySuggestionRow[] = []
  for (const relativePath of paths) {
    const suggestion = await readMemorySuggestionFile(workspaceId, relativePath)
    if (suggestion && suggestion.status === 'pending') {
      rows.push({ relativePath, suggestion })
    }
  }
  rows.sort((a, b) =>
    b.suggestion.createdAt.localeCompare(a.suggestion.createdAt),
  )
  return rows
}

export async function dismissMemorySuggestion(
  workspaceId: string,
  relativePath: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isTauri()) {
    return { ok: false, error: 'Suggestions require the desktop app.' }
  }
  const suggestion = await readMemorySuggestionFile(workspaceId, relativePath)
  if (!suggestion) {
    return { ok: false, error: 'Suggestion not found or invalid.' }
  }
  if (suggestion.status !== 'pending') {
    return { ok: false, error: 'Suggestion is not pending.' }
  }
  const next: MemorySuggestionFileV1 = {
    ...suggestion,
    status: 'dismissed',
  }
  try {
    await workspaceWriteTextFile(
      workspaceId,
      relativePath,
      `${JSON.stringify(next, null, 2)}\n`,
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg }
  }
  return { ok: true }
}

export async function acceptMemorySuggestion(
  workspaceId: string,
  relativePath: string,
): Promise<
  | { ok: true; memoryId: string; memoryRelativePath: string }
  | { ok: false; error: string }
> {
  if (!isTauri()) {
    return { ok: false, error: 'Suggestions require the desktop app.' }
  }
  const suggestion = await readMemorySuggestionFile(workspaceId, relativePath)
  if (!suggestion) {
    return { ok: false, error: 'Suggestion not found or invalid.' }
  }
  if (suggestion.status !== 'pending') {
    return { ok: false, error: 'Suggestion is not pending.' }
  }
  const created = await createWorkspaceMemoryEntry(workspaceId, {
    kind: suggestion.proposedKind,
    text: suggestion.candidateText,
    confidence: suggestion.confidence,
    conversationId: suggestion.sourceConversationId ?? null,
  })
  if (!created.ok) return created

  const next: MemorySuggestionFileV1 = {
    ...suggestion,
    status: 'accepted',
    promotedToMemoryId: created.id,
  }
  try {
    await workspaceWriteTextFile(
      workspaceId,
      relativePath,
      `${JSON.stringify(next, null, 2)}\n`,
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg }
  }
  return {
    ok: true,
    memoryId: created.id,
    memoryRelativePath: created.relativePath,
  }
}
