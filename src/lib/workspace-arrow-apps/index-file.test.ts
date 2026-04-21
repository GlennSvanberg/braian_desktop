import { describe, expect, it } from 'vitest'

import {
  normalizeArrowAppId,
  parseArrowAppsIndexJson,
  stringifyArrowAppsIndex,
} from '@/lib/workspace-arrow-apps/index-file'

describe('normalizeArrowAppId', () => {
  it('normalizes slugs', () => {
    expect(normalizeArrowAppId('Email Checker')).toBe('email-checker')
    expect(normalizeArrowAppId('calc')).toBe('calc')
  })

  it('rejects invalid', () => {
    expect(() => normalizeArrowAppId('')).toThrow()
    expect(() => normalizeArrowAppId('---')).toThrow()
  })
})

describe('parseArrowAppsIndexJson', () => {
  it('parses valid index', () => {
    const raw = JSON.stringify({
      schemaVersion: 1,
      generatedAtMs: 1,
      activeAppId: 'a',
      apps: [{ id: 'a', title: 'A', updatedAtMs: 2 }],
    })
    const p = parseArrowAppsIndexJson(raw)
    expect(p.schemaVersion).toBe(1)
    expect(p.activeAppId).toBe('a')
    expect(p.apps).toHaveLength(1)
    expect(p.apps[0]?.id).toBe('a')
  })

  it('roundtrips stringify', () => {
    const index = {
      schemaVersion: 1 as const,
      generatedAtMs: 0,
      activeAppId: 'x',
      apps: [{ id: 'x', title: 'X', updatedAtMs: 3 }],
    }
    const again = parseArrowAppsIndexJson(stringifyArrowAppsIndex(index))
    expect(again.apps[0]?.id).toBe('x')
    expect(again.activeAppId).toBe('x')
  })
})
