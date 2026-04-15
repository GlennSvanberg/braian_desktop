import { describe, expect, it } from 'vitest'

import { trimRetrievalHitsToTokenBudget } from '@/lib/retrieval/hybrid-workspace-search'
import type { RetrievalSearchHit } from '@/lib/retrieval/retrieval-api'

describe('trimRetrievalHitsToTokenBudget', () => {
  it('returns empty for tiny budget', () => {
    const hits: RetrievalSearchHit[] = [
      {
        score: 0.9,
        sourceId: 'file:x',
        chunkOrdinal: 0,
        sourceKind: 'file',
        sourceRef: '{}',
        bodyText: 'x'.repeat(10_000),
        embeddingModelId: 'm',
      },
    ]
    expect(trimRetrievalHitsToTokenBudget(hits, 10)).toBe('')
  })

  it('includes multiple small hits within budget', () => {
    const hits: RetrievalSearchHit[] = [
      {
        score: 0.5,
        sourceId: 'a',
        chunkOrdinal: 0,
        sourceKind: 'file',
        sourceRef: '{}',
        bodyText: 'hello',
        embeddingModelId: 'm',
      },
      {
        score: 0.4,
        sourceId: 'b',
        chunkOrdinal: 0,
        sourceKind: 'file',
        sourceRef: '{}',
        bodyText: 'world',
        embeddingModelId: 'm',
      },
    ]
    const t = trimRetrievalHitsToTokenBudget(hits, 4000)
    expect(t).toContain('hello')
    expect(t).toContain('world')
  })
})
