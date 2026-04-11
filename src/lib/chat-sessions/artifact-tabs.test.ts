import { describe, expect, it } from 'vitest'

import {
  ARTIFACT_TABS_PAYLOAD_KIND,
  mergeStreamArtifactIntoTabs,
  normalizeArtifactStateFromPersisted,
  serializeArtifactForPersistence,
} from '@/lib/chat-sessions/artifact-tabs'
import type { ChatThreadState } from '@/lib/chat-sessions/types'

describe('normalizeArtifactStateFromPersisted', () => {
  it('maps legacy single document payload to one tab', () => {
    const out = normalizeArtifactStateFromPersisted({
      kind: 'document',
      body: 'x',
      title: 'T',
    })
    expect(out.artifactTabs).toHaveLength(1)
    expect(out.artifactTabs[0]?.payload.kind).toBe('document')
    expect(out.activeArtifactTabId).toBe(out.artifactTabs[0]?.id)
  })

  it('parses artifact-tabs wrapper', () => {
    const out = normalizeArtifactStateFromPersisted({
      kind: ARTIFACT_TABS_PAYLOAD_KIND,
      version: 1,
      activeTabId: 't1',
      tabs: [
        {
          id: 't1',
          payload: { kind: 'document', body: 'a' },
        },
      ],
    })
    expect(out.artifactTabs).toHaveLength(1)
    expect(out.activeArtifactTabId).toBe('t1')
  })
})

describe('mergeStreamArtifactIntoTabs', () => {
  it('adds a new tab for a new workspace file path', () => {
    const base: Pick<ChatThreadState, 'artifactTabs' | 'activeArtifactTabId'> =
      {
        artifactTabs: [],
        activeArtifactTabId: null,
      }
    const next = mergeStreamArtifactIntoTabs(base, {
      kind: 'workspace-file',
      relativePath: 'a/b.txt',
      body: 'hi',
      canvasRevision: 1,
    })
    expect(next.artifactTabs).toHaveLength(1)
    expect(next.activeArtifactTabId).toBe(next.artifactTabs[0]?.id)
  })
})

describe('serializeArtifactForPersistence', () => {
  it('returns wrapper when multiple tabs', () => {
    const t: ChatThreadState = {
      messages: [],
      artifactPanelCollapsed: false,
      artifactTabs: [
        {
          id: 'a',
          payload: { kind: 'document', body: 'x' },
        },
        {
          id: 'b',
          payload: {
            kind: 'workspace-file',
            relativePath: 'f.txt',
            body: 'y',
            canvasRevision: 1,
          },
        },
      ],
      activeArtifactTabId: 'a',
      draft: '',
      generating: false,
      pendingUserMessages: [],
      contextFiles: [],
      contextConversations: [],
      agentMode: 'document',
      reasoningMode: 'fast',
      activeMcpServers: [],
      lastModelRequestSnapshot: null,
    }
    const s = serializeArtifactForPersistence(t)
    expect(s && typeof s === 'object' && 'kind' in s && s.kind).toBe(
      ARTIFACT_TABS_PAYLOAD_KIND,
    )
  })
})
