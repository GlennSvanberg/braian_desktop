import { describe, expect, it } from 'vitest'

import { parseWorkspacePreferencesFlagsFromJsonText } from '@/lib/memory/workspace-preferences'

describe('parseWorkspacePreferencesFlagsFromJsonText', () => {
  it('defaults to inject legacy MEMORY.md', () => {
    expect(parseWorkspacePreferencesFlagsFromJsonText('').injectLegacyMemoryMd).toBe(
      true,
    )
    expect(
      parseWorkspacePreferencesFlagsFromJsonText('not json').injectLegacyMemoryMd,
    ).toBe(true)
  })

  it('reads injectLegacyMemoryMd false', () => {
    const f = parseWorkspacePreferencesFlagsFromJsonText(
      JSON.stringify({ injectLegacyMemoryMd: false }),
    )
    expect(f.injectLegacyMemoryMd).toBe(false)
  })

  it('defaults when field omitted', () => {
    const f = parseWorkspacePreferencesFlagsFromJsonText(
      JSON.stringify({ theme: 'dark' }),
    )
    expect(f.injectLegacyMemoryMd).toBe(true)
  })
})
