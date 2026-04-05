import { describe, expect, it } from 'vitest'

import type { SerializableModelRequestSnapshot } from './chat-turn-args'
import { deriveSnapshotSummary } from './snapshot-summary'

function makeSnap(
  overrides: Partial<SerializableModelRequestSnapshot> = {},
): SerializableModelRequestSnapshot {
  return {
    builtAt: Date.now(),
    userText: 'hello',
    provider: 'openai',
    modelId: 'gpt-4o-mini',
    reasoningMode: 'fast',
    mockAi: false,
    isCodeMode: false,
    settingsWarnings: [],
    systemSections: [],
    messages: [],
    tools: [],
    ...overrides,
  }
}

describe('deriveSnapshotSummary', () => {
  it('returns correct mode', () => {
    expect(deriveSnapshotSummary(makeSnap({ isCodeMode: true })).mode).toBe('code')
    expect(deriveSnapshotSummary(makeSnap({ isCodeMode: false })).mode).toBe('document')
  })

  it('detects app builder from sections', () => {
    const snap = makeSnap({
      systemSections: [
        { id: 'app-builder', label: 'App builder', source: 'test', text: 'instructions' },
      ],
    })
    expect(deriveSnapshotSummary(snap).appBuilderActive).toBe(true)
    expect(deriveSnapshotSummary(makeSnap()).appBuilderActive).toBe(false)
  })

  it('counts eager vs lazy tools', () => {
    const snap = makeSnap({
      tools: [
        { name: 'a', description: 'A', sourceModule: 'x' },
        { name: 'b', description: 'B', lazy: true, sourceModule: 'x' },
        { name: 'mcp__c', description: 'C', sourceModule: 'x' },
      ],
    })
    const s = deriveSnapshotSummary(snap)
    expect(s.eagerToolCount).toBe(2)
    expect(s.lazyToolCount).toBe(1)
    expect(s.mcpToolsPresent).toBe(true)
    expect(s.toolBuckets).toHaveLength(3)
  })

  it('detects canvas state and revision', () => {
    const snap = makeSnap({
      systemSections: [
        {
          id: 'canvas-snapshot',
          label: 'Canvas',
          source: 'test',
          text: 'Canvas revision: **5** — pass this exact integer as `baseRevision` to **apply_document_canvas_patch**.\n\n# Some content that is more than 200 chars long. '.padEnd(300, 'x'),
        },
      ],
    })
    const s = deriveSnapshotSummary(snap)
    expect(s.canvasState).toBe('present')
    expect(s.canvasRevision).toBe(5)
  })

  it('counts attached files by FILE markers', () => {
    const snap = makeSnap({
      systemSections: [
        {
          id: 'context-files',
          label: 'Files',
          source: 'test',
          text: '--- FILE: a.txt ---\nhello\n--- END FILE ---\n--- FILE: b.txt ---\nworld\n--- END FILE ---',
        },
      ],
    })
    expect(deriveSnapshotSummary(snap).attachedFilesCount).toBe(2)
  })

  it('sections grouped by model-context-section-meta', () => {
    const snap = makeSnap({
      systemSections: [
        { id: 'routing-doc', label: 'Routing', source: 's', text: 'r' },
        { id: 'skills-catalog', label: 'Skills', source: 's', text: 's' },
        { id: 'user-context', label: 'User', source: 's', text: 'u' },
      ],
    })
    const s = deriveSnapshotSummary(snap)
    expect(s.sectionsByGroup.Core).toHaveLength(1)
    expect(s.sectionsByGroup.Skills).toHaveLength(1)
    expect(s.sectionsByGroup.User).toHaveLength(1)
  })
})
