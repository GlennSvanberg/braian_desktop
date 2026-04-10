import { describe, expect, it } from 'vitest'

import {
  isSemanticEntryExcludedFromSearch,
  matchesWorkspaceMemoryQuery,
} from '@/lib/memory/semantic-memory-search'

describe('matchesWorkspaceMemoryQuery', () => {
  const base = {
    id: 'mem_abc',
    kind: 'fact' as const,
    summary: 'Rust backend',
    text: 'SQLite for local data',
    tags: ['db'],
  }

  it('matches substring in summary', () => {
    expect(matchesWorkspaceMemoryQuery(base, 'rust')).toBe(true)
  })

  it('matches tag', () => {
    expect(matchesWorkspaceMemoryQuery(base, 'db')).toBe(true)
  })

  it('is case insensitive', () => {
    expect(matchesWorkspaceMemoryQuery(base, 'SQLITE')).toBe(true)
  })

  it('returns false when no match', () => {
    expect(matchesWorkspaceMemoryQuery(base, 'kubernetes')).toBe(false)
  })
})

describe('isSemanticEntryExcludedFromSearch', () => {
  it('excludes archived and superseded', () => {
    expect(isSemanticEntryExcludedFromSearch({ status: 'archived' })).toBe(true)
    expect(isSemanticEntryExcludedFromSearch({ status: 'superseded' })).toBe(
      true,
    )
    expect(isSemanticEntryExcludedFromSearch({ status: 'active' })).toBe(false)
    expect(isSemanticEntryExcludedFromSearch({ status: 'stale' })).toBe(false)
  })
})
