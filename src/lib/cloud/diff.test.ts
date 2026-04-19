import { describe, expect, it } from 'vitest'

import {
  diffForPush,
  mergeScalarsLww,
  missingMessagesFromCloud,
  type CloudThreadSnapshot,
} from './diff'
import type { ConversationSavePayload } from '@/lib/workspace-api'

function makePayload(
  overrides: Partial<ConversationSavePayload> = {},
): ConversationSavePayload {
  return {
    id: 'c1',
    workspaceId: 'w1',
    title: 'Hello',
    canvasKind: 'document',
    pinned: false,
    unread: false,
    artifactOpen: false,
    artifactPanelCollapsed: false,
    draft: '',
    messages: [],
    artifactPayload: null,
    contextFiles: [],
    contextConversations: [],
    agentMode: 'document',
    appHarnessEnabled: false,
    reasoningMode: 'fast',
    activeMcpServers: [],
    ...overrides,
  }
}

describe('diffForPush', () => {
  it('emits an upsert when no snapshot exists yet', () => {
    const payload = makePayload({ title: 'New thread' })
    const diff = diffForPush(payload, null, 1_000)
    expect(diff.upsert).toEqual({
      clientId: 'c1',
      title: 'New thread',
      pinned: false,
      unread: false,
      draft: '',
      updatedAtMs: 1_000,
    })
    expect(diff.appendMessages).toEqual([])
    expect(diff.nextSnapshot.messageIds).toEqual([])
  })

  it('skips upsert when scalar fields are unchanged', () => {
    const snapshot: CloudThreadSnapshot = {
      conversation: {
        clientId: 'c1',
        title: 'Hello',
        pinned: false,
        unread: false,
        draft: '',
        updatedAtMs: 500,
      },
      messageIds: [],
    }
    const diff = diffForPush(makePayload(), snapshot, 1_000)
    expect(diff.upsert).toBeNull()
    expect(diff.appendMessages).toEqual([])
  })

  it('emits an upsert with a fresh updatedAtMs when fields change', () => {
    const snapshot: CloudThreadSnapshot = {
      conversation: {
        clientId: 'c1',
        title: 'Old',
        pinned: false,
        unread: false,
        draft: '',
        updatedAtMs: 500,
      },
      messageIds: [],
    }
    const diff = diffForPush(
      makePayload({ title: 'New', pinned: true }),
      snapshot,
      1_000,
    )
    expect(diff.upsert).not.toBeNull()
    expect(diff.upsert?.title).toBe('New')
    expect(diff.upsert?.pinned).toBe(true)
    expect(diff.upsert?.updatedAtMs).toBe(1_000)
  })

  it('only sends new messages and tracks them in the next snapshot', () => {
    const snapshot: CloudThreadSnapshot = {
      conversation: {
        clientId: 'c1',
        title: 'Hello',
        pinned: false,
        unread: false,
        draft: '',
        updatedAtMs: 500,
      },
      messageIds: ['m1'],
    }
    const payload = makePayload({
      messages: [
        { id: 'm1', role: 'user', content: 'hi' },
        { id: 'm2', role: 'assistant', content: 'hello back' },
      ],
    })
    const diff = diffForPush(payload, snapshot, 1_000)
    expect(diff.appendMessages).toEqual([
      {
        clientMsgId: 'm2',
        role: 'assistant',
        content: 'hello back',
        status: undefined,
      },
    ])
    expect(diff.nextSnapshot.messageIds).toEqual(['m1', 'm2'])
  })

  it('skips streaming assistant messages', () => {
    const payload = makePayload({
      messages: [
        { id: 'm1', role: 'user', content: 'hi' },
        {
          id: 'm2',
          role: 'assistant',
          content: 'partial',
          status: 'streaming',
        },
      ],
    })
    const diff = diffForPush(payload, null, 1_000)
    expect(diff.appendMessages.map((m) => m.clientMsgId)).toEqual(['m1'])
    expect(diff.nextSnapshot.messageIds).toEqual(['m1'])
  })

  it('is a no-op when nothing changed and snapshot already has all messages', () => {
    const snapshot: CloudThreadSnapshot = {
      conversation: {
        clientId: 'c1',
        title: 'Hello',
        pinned: false,
        unread: false,
        draft: '',
        updatedAtMs: 500,
      },
      messageIds: ['m1', 'm2'],
    }
    const payload = makePayload({
      messages: [
        { id: 'm1', role: 'user', content: 'hi' },
        { id: 'm2', role: 'assistant', content: 'hello back' },
      ],
    })
    const diff = diffForPush(payload, snapshot, 1_000)
    expect(diff.upsert).toBeNull()
    expect(diff.appendMessages).toEqual([])
  })
})

describe('mergeScalarsLww', () => {
  it('returns empty when remote is older', () => {
    const overlay = mergeScalarsLww({
      local: { title: 'A', pinned: false, unread: false, draft: '', updatedAtMs: 1_000 },
      remote: { clientId: 'c1', title: 'B', pinned: true, unread: true, draft: 'd', updatedAtMs: 500 },
    })
    expect(overlay).toEqual({})
  })

  it('overwrites changed fields when remote is newer', () => {
    const overlay = mergeScalarsLww({
      local: { title: 'A', pinned: false, unread: false, draft: '', updatedAtMs: 500 },
      remote: { clientId: 'c1', title: 'B', pinned: true, unread: false, draft: 'd', updatedAtMs: 1_000 },
    })
    expect(overlay).toEqual({ title: 'B', pinned: true, draft: 'd' })
  })

  it('returns empty when newer remote has identical fields', () => {
    const overlay = mergeScalarsLww({
      local: { title: 'A', pinned: false, unread: false, draft: '', updatedAtMs: 500 },
      remote: { clientId: 'c1', title: 'A', pinned: false, unread: false, draft: '', updatedAtMs: 1_000 },
    })
    expect(overlay).toEqual({})
  })
})

describe('missingMessagesFromCloud', () => {
  it('returns cloud messages absent locally, in cloud order', () => {
    const local = [{ id: 'm1' }, { id: 'm3' }]
    const remote = [
      { clientMsgId: 'm1', orderKey: 1 },
      { clientMsgId: 'm2', orderKey: 2 },
      { clientMsgId: 'm3', orderKey: 3 },
      { clientMsgId: 'm4', orderKey: 4 },
    ]
    const out = missingMessagesFromCloud(local, remote)
    expect(out.map((m) => m.clientMsgId)).toEqual(['m2', 'm4'])
  })
})
