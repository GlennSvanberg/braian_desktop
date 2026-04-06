import { describe, expect, it } from 'vitest'

import {
  DEFAULT_HUB_SECTIONS,
  resolveHubSections,
  type HubDashboardManifest,
} from '@/lib/workspace-hub-types'

describe('resolveHubSections', () => {
  it('uses defaults when manifest is null', () => {
    expect(resolveHubSections(null)).toEqual(DEFAULT_HUB_SECTIONS)
  })

  it('uses defaults when schema version is below 1', () => {
    const m: HubDashboardManifest = { schemaVersion: 0, sections: [] }
    expect(resolveHubSections(m)).toEqual(DEFAULT_HUB_SECTIONS)
  })

  it('respects custom order and drops disabled and unknown types', () => {
    const m: HubDashboardManifest = {
      schemaVersion: 1,
      sections: [
        { id: 'a', type: 'kpis', enabled: true },
        { id: 'b', type: 'welcome', enabled: false },
        { id: 'c', type: 'continue', enabled: true },
        { id: 'x', type: 'typo', enabled: true },
      ] as unknown as HubDashboardManifest['sections'],
    }
    const r = resolveHubSections(m)
    expect(r.map((s) => s.type)).toEqual(['kpis', 'continue'])
  })
})
