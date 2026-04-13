import { describe, expect, it } from 'vitest'

import { normalizeMemorySectionHeading } from '@/lib/ai/workspace-memory-tools'

describe('normalizeMemorySectionHeading', () => {
  it('defaults to Preferences', () => {
    expect(normalizeMemorySectionHeading(undefined)).toBe('Preferences')
    expect(normalizeMemorySectionHeading('')).toBe('Preferences')
    expect(normalizeMemorySectionHeading('   ')).toBe('Preferences')
  })

  it('strips leading hashes', () => {
    expect(normalizeMemorySectionHeading('## Decisions')).toBe('Decisions')
  })
})
