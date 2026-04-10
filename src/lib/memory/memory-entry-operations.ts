import { SEMANTIC_MEMORY_ROOT } from '@/lib/memory/constants'
import {
  kindToDir,
  type SemanticMemoryRecordV1,
} from '@/lib/memory/semantic-record'
import {
  readSemanticMemoryRecord,
  writeSemanticMemoryRecord,
} from '@/lib/memory/semantic-store'

export type MemoryEntryKindRef = {
  kind: SemanticMemoryRecordV1['kind']
  entryId: string
}

export function memoryEntryRelativePath(
  kind: SemanticMemoryRecordV1['kind'],
  entryId: string,
): string {
  return `${SEMANTIC_MEMORY_ROOT}/${kindToDir(kind)}/${entryId}.json`
}

export async function loadMemoryEntryByRef(
  workspaceId: string,
  ref: MemoryEntryKindRef,
): Promise<
  | { ok: true; record: SemanticMemoryRecordV1; relativePath: string }
  | { ok: false; error: string }
> {
  const relativePath = memoryEntryRelativePath(ref.kind, ref.entryId)
  const record = await readSemanticMemoryRecord(workspaceId, relativePath)
  if (!record || record.id !== ref.entryId) {
    return { ok: false, error: 'Entry not found.' }
  }
  return { ok: true, record, relativePath }
}

export async function archiveMemoryEntry(
  workspaceId: string,
  ref: MemoryEntryKindRef,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const loaded = await loadMemoryEntryByRef(workspaceId, ref)
  if (!loaded.ok) return loaded
  const next: SemanticMemoryRecordV1 = {
    ...loaded.record,
    status: 'archived',
    updatedAt: new Date().toISOString(),
  }
  await writeSemanticMemoryRecord(workspaceId, loaded.relativePath, next)
  return { ok: true }
}

export async function markMemoryStale(
  workspaceId: string,
  ref: MemoryEntryKindRef,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const loaded = await loadMemoryEntryByRef(workspaceId, ref)
  if (!loaded.ok) return loaded
  const next: SemanticMemoryRecordV1 = {
    ...loaded.record,
    status: 'stale',
    updatedAt: new Date().toISOString(),
  }
  await writeSemanticMemoryRecord(workspaceId, loaded.relativePath, next)
  return { ok: true }
}

export async function validateMemoryEntry(
  workspaceId: string,
  ref: MemoryEntryKindRef,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const loaded = await loadMemoryEntryByRef(workspaceId, ref)
  if (!loaded.ok) return loaded
  const now = new Date().toISOString()
  const next: SemanticMemoryRecordV1 = {
    ...loaded.record,
    status: 'active',
    updatedAt: now,
    lastValidatedAt: now,
  }
  await writeSemanticMemoryRecord(workspaceId, loaded.relativePath, next)
  return { ok: true }
}

export type MemoryEntryEditableFields = {
  text: string
  summary: string
  tags: string[]
  scope: SemanticMemoryRecordV1['scope']
}

export async function updateMemoryEntryFields(
  workspaceId: string,
  ref: MemoryEntryKindRef,
  patch: Partial<MemoryEntryEditableFields>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const loaded = await loadMemoryEntryByRef(workspaceId, ref)
  if (!loaded.ok) return loaded
  const r = loaded.record
  const next: SemanticMemoryRecordV1 = {
    ...r,
    text: patch.text !== undefined ? patch.text.trim() : r.text,
    summary: patch.summary !== undefined ? patch.summary.trim() : r.summary,
    tags: patch.tags !== undefined ? patch.tags : r.tags,
    scope: patch.scope !== undefined ? patch.scope : r.scope,
    updatedAt: new Date().toISOString(),
  }
  await writeSemanticMemoryRecord(workspaceId, loaded.relativePath, next)
  return { ok: true }
}
