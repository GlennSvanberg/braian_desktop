import { describe, expect, it } from 'vitest'

import { compareSemver, stripReleaseVersion } from '@/lib/desktop-release-check'

describe('stripReleaseVersion', () => {
  it('strips leading v', () => {
    expect(stripReleaseVersion('v1.2.3')).toBe('1.2.3')
    expect(stripReleaseVersion('V0.0.1')).toBe('0.0.1')
  })
})

describe('compareSemver', () => {
  it('orders major minor patch', () => {
    expect(compareSemver('0.1.0', '0.1.0')).toBe(0)
    expect(compareSemver('0.2.0', '0.1.0')).toBe(1)
    expect(compareSemver('0.1.0', '0.2.0')).toBe(-1)
    expect(compareSemver('1.0.0', '0.9.9')).toBe(1)
  })

  it('ignores pre-release suffix for ordering', () => {
    expect(compareSemver('1.0.0-beta.1', '1.0.0')).toBe(0)
  })
})
