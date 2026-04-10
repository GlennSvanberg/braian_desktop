import { describe, expect, it } from 'vitest'

import { parseMemorySuggestionJson } from '@/lib/memory/suggestion-queue'

describe('parseMemorySuggestionJson', () => {
  it('parses valid suggestion file', () => {
    const raw = JSON.stringify({
      schemaVersion: 1,
      id: 'mem_test12345678901234',
      status: 'pending',
      proposedKind: 'fact',
      candidateText: 'hello',
      confidence: 0.9,
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    const p = parseMemorySuggestionJson(raw)
    expect(p).not.toBeNull()
    expect(p?.proposedKind).toBe('fact')
    expect(p?.candidateText).toBe('hello')
  })

  it('accepts optional promotedToMemoryId', () => {
    const raw = JSON.stringify({
      schemaVersion: 1,
      id: 'mem_a',
      status: 'accepted',
      proposedKind: 'pattern',
      candidateText: 'x',
      confidence: 0.5,
      createdAt: '2026-01-01T00:00:00.000Z',
      promotedToMemoryId: 'mem_b',
    })
    const p = parseMemorySuggestionJson(raw)
    expect(p?.promotedToMemoryId).toBe('mem_b')
  })

  it('returns null for invalid json', () => {
    expect(parseMemorySuggestionJson('not json')).toBeNull()
  })
})
