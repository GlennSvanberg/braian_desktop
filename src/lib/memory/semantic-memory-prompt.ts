import type { SemanticMemoryRecordV1 } from '@/lib/memory/semantic-record'

const PREAMBLE_LINES = [
  'Structured workspace memory (JSON under `.braian/memory/`; active entries, most recently updated first):',
  '',
]

/**
 * Pack active memory records into prompt text under a UTF-8 byte budget (used for semantic memory system section).
 * The introductory lines count toward the budget.
 */
export function packSemanticMemoryBlocksForBudget(
  records: SemanticMemoryRecordV1[],
  maxBytes: number,
): string {
  const sorted = [...records].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  )
  const preamble = PREAMBLE_LINES.join('\n')
  let used = new TextEncoder().encode(preamble).length
  const parts: string[] = []
  for (const record of sorted) {
    const block = [
      `### ${record.id} (${record.kind})`,
      record.summary.trim() || record.text.slice(0, 200),
      record.text.length > 400 ? `\n${record.text.slice(0, 400)}…` : `\n${record.text}`,
      '',
    ].join('\n')
    const nextBytes = new TextEncoder().encode(block).length
    if (used + nextBytes > maxBytes) break
    parts.push(block)
    used += nextBytes
  }
  if (parts.length === 0) return ''
  return [...PREAMBLE_LINES, parts.join('\n')].join('\n')
}
