import type { SerializableModelRequestSnapshot } from './chat-turn-args'
import { modelContextSectionGroup, type ModelContextSectionGroup } from './model-context-section-meta'

export type SectionSummary = {
  id: string
  label: string
  group: ModelContextSectionGroup
  charCount: number
  lineCount: number
  preview: string
}

export type ToolBucket = {
  label: string
  tools: { name: string; description: string; lazy: boolean }[]
}

export type SnapshotSummary = {
  mode: 'document' | 'code'
  provider: string
  modelId: string
  reasoningMode: string
  mockAi: boolean
  appBuilderActive: boolean
  canvasState: 'present' | 'empty' | 'none'
  canvasRevision: number | null
  attachedFilesCount: number
  skillCatalogPresent: boolean
  mcpToolsPresent: boolean
  memoryPresent: boolean
  totalSystemChars: number
  totalMessageCount: number
  totalToolCount: number
  eagerToolCount: number
  lazyToolCount: number
  sectionsByGroup: Record<ModelContextSectionGroup, SectionSummary[]>
  toolBuckets: ToolBucket[]
}

const PREVIEW_MAX = 120

function previewText(text: string): string {
  const first = text.slice(0, PREVIEW_MAX).replace(/\s+/g, ' ').trim()
  return text.length > PREVIEW_MAX ? first + '…' : first
}

function extractCanvasRevision(sections: { id: string; text: string }[]): number | null {
  const snap = sections.find((s) => s.id === 'canvas-snapshot')
  if (!snap) return null
  const m = snap.text.match(/Canvas revision:\s*\**(\d+)\**/i)
  return m ? parseInt(m[1], 10) : null
}

export function deriveSnapshotSummary(
  snap: SerializableModelRequestSnapshot,
): SnapshotSummary {
  const sections: SectionSummary[] = snap.systemSections.map((s) => ({
    id: s.id,
    label: s.label,
    group: modelContextSectionGroup(s.id),
    charCount: s.text.length,
    lineCount: s.text.split('\n').length,
    preview: previewText(s.text),
  }))

  const groups: Record<ModelContextSectionGroup, SectionSummary[]> = {
    Core: [],
    Skills: [],
    User: [],
    Workspace: [],
    'This turn': [],
    Profile: [],
  }
  for (const s of sections) {
    groups[s.group].push(s)
  }

  const canvasSection = snap.systemSections.find((s) => s.id === 'canvas-snapshot')
  const canvasState: 'present' | 'empty' | 'none' = canvasSection
    ? canvasSection.text.length > 200
      ? 'present'
      : 'empty'
    : 'none'

  const eagerTools = snap.tools.filter((t) => !t.lazy)
  const lazyTools = snap.tools.filter((t) => t.lazy)

  const toolBuckets: ToolBucket[] = []
  const mcpTools = snap.tools.filter((t) => t.name.startsWith('mcp__'))
  const coreEager = eagerTools.filter((t) => !t.name.startsWith('mcp__'))
  if (coreEager.length > 0) {
    toolBuckets.push({
      label: `Eager (${coreEager.length})`,
      tools: coreEager.map((t) => ({ name: t.name, description: t.description, lazy: false })),
    })
  }
  if (lazyTools.length > 0) {
    toolBuckets.push({
      label: `Lazy (${lazyTools.length})`,
      tools: lazyTools.map((t) => ({ name: t.name, description: t.description, lazy: true })),
    })
  }
  if (mcpTools.length > 0) {
    toolBuckets.push({
      label: `MCP (${mcpTools.length})`,
      tools: mcpTools.map((t) => ({
        name: t.name,
        description: t.description,
        lazy: !!t.lazy,
      })),
    })
  }

  return {
    mode: snap.isCodeMode ? 'code' : 'document',
    provider: snap.provider,
    modelId: snap.modelId,
    reasoningMode: snap.reasoningMode,
    mockAi: snap.mockAi,
    appBuilderActive: snap.systemSections.some((s) => s.id === 'app-builder'),
    canvasState,
    canvasRevision: extractCanvasRevision(snap.systemSections),
    attachedFilesCount: snap.systemSections.filter((s) => s.id === 'context-files').length > 0
      ? (snap.systemSections.find((s) => s.id === 'context-files')?.text.match(/--- FILE:/g)?.length ?? 0)
      : 0,
    skillCatalogPresent: snap.systemSections.some((s) => s.id === 'skills-catalog'),
    mcpToolsPresent: mcpTools.length > 0,
    memoryPresent: snap.systemSections.some((s) => s.id === 'memory'),
    totalSystemChars: snap.systemSections.reduce((sum, s) => sum + s.text.length, 0),
    totalMessageCount: snap.messages.length,
    totalToolCount: snap.tools.length,
    eagerToolCount: eagerTools.length,
    lazyToolCount: lazyTools.length,
    sectionsByGroup: groups,
    toolBuckets,
  }
}
