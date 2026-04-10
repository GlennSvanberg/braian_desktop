import { describe, expect, it } from 'vitest'

import { migrateSummaryToV2 } from '@/lib/conversation/working-memory'

describe('migrateSummaryToV2', () => {
  const cid = 'conv-1'

  it('parses v2 as-is', () => {
    const v2 = {
      schemaVersion: 2,
      conversationId: cid,
      updatedAt: '2026-01-01T00:00:00.000Z',
      summary: 's',
      openLoops: ['a'],
      coveredMessageIds: ['m1'],
      importantDecisions: ['Use SQLite'],
    }
    const r = migrateSummaryToV2(v2, cid)
    expect(r?.importantDecisions).toEqual(['Use SQLite'])
    expect(r?.schemaVersion).toBe(2)
  })

  it('migrates v1 to v2 with empty importantDecisions', () => {
    const v1 = {
      schemaVersion: 1,
      conversationId: cid,
      updatedAt: '2026-01-01T00:00:00.000Z',
      summary: 'old',
      openLoops: [],
      coveredMessageIds: [],
    }
    const r = migrateSummaryToV2(v1, cid)
    expect(r?.schemaVersion).toBe(2)
    expect(r?.importantDecisions).toEqual([])
    expect(r?.summary).toBe('old')
  })

  it('returns null for wrong conversation id', () => {
    const v2 = {
      schemaVersion: 2,
      conversationId: 'other',
      updatedAt: '2026-01-01T00:00:00.000Z',
      summary: '',
      openLoops: [],
      coveredMessageIds: [],
      importantDecisions: [],
    }
    expect(migrateSummaryToV2(v2, cid)).toBeNull()
  })
})
