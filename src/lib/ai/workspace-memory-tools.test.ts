import { describe, expect, it } from 'vitest'

import {
  appendToWorkspaceMemoryMarkdown,
  normalizeMemorySectionHeading,
  WORKSPACE_MEMORY_DEFAULT_TEMPLATE,
} from '@/lib/ai/workspace-memory-tools'

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

describe('appendToWorkspaceMemoryMarkdown', () => {
  it('appends under existing Preferences section', () => {
    const body = `${WORKSPACE_MEMORY_DEFAULT_TEMPLATE.trimEnd()}\n`
    const next = appendToWorkspaceMemoryMarkdown(
      body,
      '- Use pnpm',
      undefined,
    )
    expect(next).toContain('## Preferences')
    expect(next).toContain('- Use pnpm')
    expect(next.indexOf('- Use pnpm')).toBeGreaterThan(
      next.indexOf('## Preferences'),
    )
    expect(next.indexOf('## Decisions')).toBeGreaterThan(
      next.indexOf('- Use pnpm'),
    )
  })

  it('creates section when missing', () => {
    const next = appendToWorkspaceMemoryMarkdown(
      '# Title only\n',
      '- Note',
      'Custom',
    )
    expect(next).toContain('## Custom')
    expect(next).toContain('- Note')
  })

  it('throws on empty markdownLines', () => {
    expect(() => appendToWorkspaceMemoryMarkdown('x', '', undefined)).toThrow(
      /empty/,
    )
  })
})
