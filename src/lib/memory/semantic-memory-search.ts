import type { SemanticMemoryRecordV1 } from '@/lib/memory/semantic-record'

/** Entries that should not appear in default semantic memory search. */
export function isSemanticEntryExcludedFromSearch(
  record: Pick<SemanticMemoryRecordV1, 'status'>,
): boolean {
  return record.status === 'archived' || record.status === 'superseded'
}

export function matchesWorkspaceMemoryQuery(
  record: Pick<
    SemanticMemoryRecordV1,
    'id' | 'kind' | 'summary' | 'text' | 'tags'
  >,
  query: string,
): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return false
  const hay = [
    record.id,
    record.kind,
    record.summary,
    record.text,
    ...record.tags,
  ]
    .join('\n')
    .toLowerCase()
  return hay.includes(q)
}
