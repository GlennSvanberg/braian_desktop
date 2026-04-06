import type {
  TabularColumn,
  TabularRow,
  TabularSection,
  WorkspaceArtifactPayload,
} from '@/lib/artifacts/types'

const TABULAR_TYPES = ['string', 'number', 'date', 'boolean'] as const
type TabularType = (typeof TABULAR_TYPES)[number]

function isTabularType(s: string): s is TabularType {
  return (TABULAR_TYPES as readonly string[]).includes(s)
}

/** Coerce tool-emitted JSON cell values to TabularRow-compatible primitives. */
export function coerceTabularCellValue(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function parseTabularColumn(raw: unknown): TabularColumn | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.id !== 'string' || typeof o.label !== 'string') return null
  const col: TabularColumn = { id: o.id, label: o.label }
  if (typeof o.type === 'string' && isTabularType(o.type)) {
    col.type = o.type
  }
  return col
}

function parseTabularColumns(raw: unknown): TabularColumn[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const cols: TabularColumn[] = []
  for (const item of raw) {
    const c = parseTabularColumn(item)
    if (!c) return null
    cols.push(c)
  }
  return cols
}

function parseTabularRows(raw: unknown): TabularRow[] | null {
  if (!Array.isArray(raw)) return null
  const out: TabularRow[] = []
  for (const row of raw) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return null
    const o = row as Record<string, unknown>
    const tr: TabularRow = {}
    for (const k of Object.keys(o)) {
      tr[k] = coerceTabularCellValue(o[k])
    }
    out.push(tr)
  }
  return out
}

function parseTabularSection(raw: unknown): TabularSection | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const columns = parseTabularColumns(o.columns)
  const rows = parseTabularRows(o.rows)
  if (!columns || !rows) return null
  const sec: TabularSection = { columns, rows }
  if (typeof o.title === 'string' && o.title !== '') sec.title = o.title
  if (typeof o.sourceLabel === 'string' && o.sourceLabel !== '') {
    sec.sourceLabel = o.sourceLabel
  }
  return sec
}

/**
 * Maps TanStack tool `emitCustomEvent('braian-artifact', value)` payloads to workspace artifact state.
 */
export function braianArtifactFromCustomValue(
  value: unknown,
): WorkspaceArtifactPayload | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const kind = v.kind

  if (kind === 'document') {
    if (typeof v.body !== 'string') return null
    const revRaw = v.canvasRevision
    const canvasRevision =
      typeof revRaw === 'number' && Number.isFinite(revRaw)
        ? Math.trunc(revRaw)
        : undefined
    return {
      kind: 'document',
      body: v.body,
      ...(typeof v.title === 'string' ? { title: v.title } : {}),
      ...(canvasRevision !== undefined ? { canvasRevision } : {}),
    }
  }

  if (kind === 'tabular') {
    const columns = parseTabularColumns(v.columns)
    const rows = parseTabularRows(v.rows)
    if (!columns || !rows) return null
    const payload: WorkspaceArtifactPayload = {
      kind: 'tabular',
      columns,
      rows,
    }
    if (typeof v.title === 'string' && v.title !== '') payload.title = v.title
    if (typeof v.sourceLabel === 'string' && v.sourceLabel !== '') {
      payload.sourceLabel = v.sourceLabel
    }
    return payload
  }

  if (kind === 'tabular-multi') {
    if (!Array.isArray(v.sections) || v.sections.length === 0) return null
    const sections: TabularSection[] = []
    for (const s of v.sections) {
      const sec = parseTabularSection(s)
      if (!sec) return null
      sections.push(sec)
    }
    const payload: WorkspaceArtifactPayload = {
      kind: 'tabular-multi',
      sections,
    }
    if (typeof v.title === 'string' && v.title !== '') payload.title = v.title
    return payload
  }

  if (kind === 'visual') {
    const payload: WorkspaceArtifactPayload = { kind: 'visual' }
    if (typeof v.title === 'string' && v.title !== '') payload.title = v.title
    if (typeof v.prompt === 'string' && v.prompt !== '') payload.prompt = v.prompt
    if (typeof v.imageSrc === 'string' && v.imageSrc !== '') {
      payload.imageSrc = v.imageSrc
    }
    if (typeof v.alt === 'string' && v.alt !== '') payload.alt = v.alt
    return payload
  }

  return null
}
