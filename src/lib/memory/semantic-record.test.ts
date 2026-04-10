import { describe, expect, it } from 'vitest'

import {
  kindToDir,
  semanticMemoryRecordSchemaV1,
} from '@/lib/memory/semantic-record'

describe('semanticMemoryRecordSchemaV1', () => {
  it('accepts a minimal valid record', () => {
    const raw = {
      schemaVersion: 1,
      id: 'mem_test123',
      kind: 'fact',
      scope: 'workspace',
      text: 'We use Vitest.',
      summary: 'Test runner',
      confidence: 0.9,
      status: 'active',
      tags: ['qa'],
      sourceRefs: [{ type: 'file', path: 'package.json' }],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      supersedes: [],
    }
    const r = semanticMemoryRecordSchemaV1.safeParse(raw)
    expect(r.success).toBe(true)
  })

  it('rejects invalid status', () => {
    const raw = {
      schemaVersion: 1,
      id: 'mem_x',
      kind: 'fact',
      scope: 'workspace',
      text: 't',
      summary: 's',
      confidence: 1,
      status: 'invalid',
      tags: [],
      sourceRefs: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      supersedes: [],
    }
    expect(semanticMemoryRecordSchemaV1.safeParse(raw).success).toBe(false)
  })
})

describe('kindToDir', () => {
  it('maps kinds to folder names', () => {
    expect(kindToDir('fact')).toBe('facts')
    expect(kindToDir('preference')).toBe('preferences')
    expect(kindToDir('pattern')).toBe('patterns')
  })
})
