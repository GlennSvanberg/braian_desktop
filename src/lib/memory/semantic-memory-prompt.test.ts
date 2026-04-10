import { describe, expect, it } from 'vitest'

import { packSemanticMemoryBlocksForBudget } from '@/lib/memory/semantic-memory-prompt'
import type { SemanticMemoryRecordV1 } from '@/lib/memory/semantic-record'

function rec(
  id: string,
  updatedAt: string,
  text: string,
): SemanticMemoryRecordV1 {
  return {
    schemaVersion: 1,
    id,
    kind: 'fact',
    scope: 'workspace',
    text,
    summary: text.slice(0, 40),
    confidence: 0.9,
    status: 'active',
    tags: [],
    sourceRefs: [],
    createdAt: updatedAt,
    updatedAt,
    supersedes: [],
  }
}

describe('packSemanticMemoryBlocksForBudget', () => {
  it('returns empty for empty input', () => {
    expect(packSemanticMemoryBlocksForBudget([], 1000)).toBe('')
  })

  it('includes header when something fits', () => {
    const out = packSemanticMemoryBlocksForBudget(
      [rec('mem_a', '2026-01-02T00:00:00.000Z', 'Hello')],
      50_000,
    )
    expect(out).toContain('Structured workspace memory')
    expect(out).toContain('mem_a')
    expect(out).toContain('Hello')
  })

  it('respects byte budget (may omit oversized single record)', () => {
    const huge = rec('mem_b', '2026-01-03T00:00:00.000Z', 'x'.repeat(100_000))
    const out = packSemanticMemoryBlocksForBudget([huge], 500)
    expect(out.length).toBeLessThanOrEqual(500)
  })

  it('orders by updatedAt descending', () => {
    const out = packSemanticMemoryBlocksForBudget(
      [
        rec('old', '2026-01-01T00:00:00.000Z', 'first'),
        rec('new', '2026-01-10T00:00:00.000Z', 'second'),
      ],
      50_000,
    )
    expect(out.indexOf('new')).toBeLessThan(out.indexOf('old'))
  })
})
