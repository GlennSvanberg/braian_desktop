import { describe, expect, it } from 'vitest'

import {
  openConversationMessagesByIds,
  parseConversationTranscriptJson,
  searchConversationMessages,
} from './conversation-archive-tools'

const sampleJson = `{
  "schemaVersion": 1,
  "id": "conv-1",
  "workspaceId": "ws",
  "title": "t",
  "updatedAtMs": 0,
  "canvasKind": "document",
  "artifactOpen": false,
  "draft": "",
  "messages": [
    { "id": "m1", "role": "user", "content": "Hello world" },
    { "id": "m2", "role": "assistant", "content": "We use Rust and SQLite for storage." },
    { "id": "m3", "role": "user", "content": "Thanks" }
  ]
}`

describe('parseConversationTranscriptJson', () => {
  it('parses messages and id', () => {
    const p = parseConversationTranscriptJson(sampleJson)
    expect(p.conversationId).toBe('conv-1')
    expect(p.messages).toHaveLength(3)
    expect(p.messages[1]?.content).toContain('SQLite')
  })
})

describe('searchConversationMessages', () => {
  it('finds full phrase', () => {
    const p = parseConversationTranscriptJson(sampleJson)
    const hits = searchConversationMessages(p.messages, 'Rust and SQLite', 10)
    expect(hits).toHaveLength(1)
    expect(hits[0]?.messageId).toBe('m2')
    expect(hits[0]?.role).toBe('assistant')
  })

  it('matches all words when phrase not contiguous', () => {
    const p = parseConversationTranscriptJson(sampleJson)
    const hits = searchConversationMessages(p.messages, 'rust storage', 10)
    expect(hits.some((h) => h.messageId === 'm2')).toBe(true)
  })

  it('respects maxResults', () => {
    const p = parseConversationTranscriptJson(sampleJson)
    const hits = searchConversationMessages(p.messages, 'a', 1)
    expect(hits.length).toBeLessThanOrEqual(1)
  })
})

describe('openConversationMessagesByIds', () => {
  it('returns chronological order and missing ids', () => {
    const p = parseConversationTranscriptJson(sampleJson)
    const { found, missingIds } = openConversationMessagesByIds(
      p.messages,
      ['m3', 'm1', 'missing'],
      100_000,
    )
    expect(missingIds).toEqual(['missing'])
    expect(found.map((f) => f.messageId)).toEqual(['m1', 'm3'])
    expect(found[0]?.content).toBe('Hello world')
  })

  it('truncates long content', () => {
    const p = parseConversationTranscriptJson(sampleJson)
    const { found } = openConversationMessagesByIds(p.messages, ['m2'], 10)
    expect(found[0]?.content.endsWith('…')).toBe(true)
  })
})
