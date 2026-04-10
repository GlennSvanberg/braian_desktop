import {
  SEMANTIC_MEMORY_INDEX_RELATIVE_PATH,
  SEMANTIC_MEMORY_KIND_DIRS,
  SEMANTIC_MEMORY_ROOT,
  SEMANTIC_MEMORY_INJECT_MAX_BYTES,
} from '@/lib/memory/constants'
import {
  kindToDir,
  newMemoryId,
  semanticMemoryRecordSchemaV1,
  type SemanticMemoryRecordV1,
} from '@/lib/memory/semantic-record'
import {
  workspaceListDir,
  workspaceReadTextFile,
  workspaceWriteTextFile,
} from '@/lib/workspace-api'
import { isTauri } from '@/lib/tauri-env'

import { maybeNotifyMemoryIndexUpsert } from '@/lib/memory/memory-index-bridge'
import { packSemanticMemoryBlocksForBudget } from '@/lib/memory/semantic-memory-prompt'

const READ_MAX = 512 * 1024

function posix(p: string): string {
  return p.replace(/\\/g, '/')
}

async function walkJsonFiles(
  workspaceId: string,
  relativeDir: string,
  out: string[],
): Promise<void> {
  if (!isTauri()) return
  let entries: Awaited<ReturnType<typeof workspaceListDir>>
  try {
    entries = await workspaceListDir(workspaceId, relativeDir)
  } catch {
    return
  }
  for (const e of entries) {
    const rel = posix(e.relativePath)
    if (e.isDir) {
      await walkJsonFiles(workspaceId, rel, out)
    } else if (e.name.endsWith('.json')) {
      out.push(rel)
    }
  }
}

/** All structured memory record paths (excludes `_suggestions` unless asked). */
export async function listSemanticMemoryRecordPaths(
  workspaceId: string,
): Promise<string[]> {
  const out: string[] = []
  for (const kind of SEMANTIC_MEMORY_KIND_DIRS) {
    await walkJsonFiles(workspaceId, `${SEMANTIC_MEMORY_ROOT}/${kind}`, out)
  }
  return out
}

export async function readSemanticMemoryRecord(
  workspaceId: string,
  relativePath: string,
): Promise<SemanticMemoryRecordV1 | null> {
  if (!isTauri()) return null
  try {
    const { text } = await workspaceReadTextFile(workspaceId, relativePath, READ_MAX)
    const parsed = JSON.parse(text) as unknown
    const r = semanticMemoryRecordSchemaV1.safeParse(parsed)
    return r.success ? r.data : null
  } catch {
    return null
  }
}

export async function loadAllSemanticRecords(
  workspaceId: string,
): Promise<{ record: SemanticMemoryRecordV1; relativePath: string }[]> {
  const paths = await listSemanticMemoryRecordPaths(workspaceId)
  const rows: { record: SemanticMemoryRecordV1; relativePath: string }[] = []
  for (const p of paths) {
    const record = await readSemanticMemoryRecord(workspaceId, p)
    if (record) rows.push({ record, relativePath: p })
  }
  return rows
}

function isoNow(): string {
  return new Date().toISOString()
}

export type CreateWorkspaceMemoryEntryInput = {
  kind: SemanticMemoryRecordV1['kind']
  text: string
  summary?: string
  tags?: string[]
  confidence?: number
  conversationId?: string | null
  /** Optional extra source refs (e.g. from suggestion promotion). */
  additionalSourceRefs?: SemanticMemoryRecordV1['sourceRefs']
}

export type RememberWorkspaceMemoryInput = {
  kind: 'fact' | 'preference'
  text: string
  summary?: string
  tags?: string[]
  confidence?: number
  conversationId?: string | null
}

/** Create a structured memory record for any supported kind (facts, preferences, decisions, etc.). */
export async function createWorkspaceMemoryEntry(
  workspaceId: string,
  input: CreateWorkspaceMemoryEntryInput,
): Promise<{ ok: true; id: string; relativePath: string } | { ok: false; error: string }> {
  if (!isTauri()) {
    return { ok: false, error: 'Structured memory requires the desktop app.' }
  }

  const id = newMemoryId()
  const dir = kindToDir(input.kind)
  const relativePath = `${SEMANTIC_MEMORY_ROOT}/${dir}/${id}.json`
  const summary =
    input.summary?.trim() ||
    (input.text.length > 160 ? `${input.text.slice(0, 157)}…` : input.text)

  const sourceRefs: SemanticMemoryRecordV1['sourceRefs'] = []
  if (input.conversationId?.trim()) {
    sourceRefs.push({
      type: 'conversation',
      conversationId: input.conversationId.trim(),
    })
  }
  if (input.additionalSourceRefs?.length) {
    sourceRefs.push(...input.additionalSourceRefs)
  }

  const record: SemanticMemoryRecordV1 = {
    schemaVersion: 1,
    id,
    kind: input.kind,
    scope: 'workspace',
    text: input.text.trim(),
    summary,
    confidence:
      input.confidence !== undefined
        ? Math.min(1, Math.max(0, input.confidence))
        : 0.85,
    status: 'active',
    tags: input.tags?.map((t) => t.trim()).filter(Boolean) ?? [],
    sourceRefs,
    createdAt: isoNow(),
    updatedAt: isoNow(),
    supersedes: [],
  }

  try {
    await workspaceWriteTextFile(
      workspaceId,
      relativePath,
      `${JSON.stringify(record, null, 2)}\n`,
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg }
  }

  await regenerateSemanticMemoryIndex(workspaceId)
  void maybeNotifyMemoryIndexUpsert(workspaceId, record, relativePath)

  return { ok: true, id, relativePath }
}

export async function rememberWorkspaceMemoryEntry(
  workspaceId: string,
  input: RememberWorkspaceMemoryInput,
): Promise<{ ok: true; id: string; relativePath: string } | { ok: false; error: string }> {
  return createWorkspaceMemoryEntry(workspaceId, {
    kind: input.kind,
    text: input.text,
    summary: input.summary,
    tags: input.tags,
    confidence: input.confidence,
    conversationId: input.conversationId,
  })
}

export async function writeSemanticMemoryRecord(
  workspaceId: string,
  relativePath: string,
  record: SemanticMemoryRecordV1,
): Promise<void> {
  await workspaceWriteTextFile(
    workspaceId,
    relativePath,
    `${JSON.stringify(record, null, 2)}\n`,
  )
  await regenerateSemanticMemoryIndex(workspaceId)
  void maybeNotifyMemoryIndexUpsert(
    workspaceId,
    record,
    relativePath.replace(/\\/g, '/'),
  )
}

export async function regenerateSemanticMemoryIndex(
  workspaceId: string,
): Promise<void> {
  const rows = await loadAllSemanticRecords(workspaceId)
  rows.sort((a, b) =>
    b.record.updatedAt.localeCompare(a.record.updatedAt),
  )
  const lines: string[] = [
    '# Workspace semantic memory (generated)',
    '',
    'Structured JSON records under `.braian/memory/`. Edit via the Memory UI or tools; this file is regenerated.',
    '',
  ]
  for (const { record, relativePath } of rows) {
    lines.push(
      `- **${record.id}** (${record.kind}, ${record.status}) — ${record.summary}`,
    )
    lines.push(`  - Path: \`${relativePath}\``)
  }
  if (rows.length === 0) {
    lines.push('_(no structured memory entries yet)_')
  }
  lines.push('')
  try {
    await workspaceWriteTextFile(
      workspaceId,
      SEMANTIC_MEMORY_INDEX_RELATIVE_PATH,
      lines.join('\n'),
    )
  } catch {
    /* ignore */
  }
}

/**
 * Build system text for active structured memory: active first, by updatedAt desc, byte cap.
 */
export async function buildSemanticMemorySystemText(
  workspaceId: string,
): Promise<string> {
  if (!isTauri()) return ''
  const rows = await loadAllSemanticRecords(workspaceId)
  const active = rows
    .filter((r) => r.record.status === 'active')
    .map((r) => r.record)

  return packSemanticMemoryBlocksForBudget(active, SEMANTIC_MEMORY_INJECT_MAX_BYTES)
}
