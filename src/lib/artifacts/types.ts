/**
 * Workspace canvas payloads — discriminated union the real LLM/tools should emit.
 * User-facing labels: Document, Data, Visual (avoid "artifact" in UI).
 */
export type ArtifactKind =
  | 'document'
  | 'tabular'
  | 'tabular-multi'
  | 'visual'
  | 'app-preview'

export type TabularColumn = {
  id: string
  /** Column header shown in the table */
  label: string
  /** Hint for formatting; optional for AI emitters */
  type?: 'string' | 'number' | 'date' | 'boolean'
}

/** Row cells keyed by column id */
export type TabularRow = Record<string, string | number | boolean | null>

export type DocumentArtifactPayload = {
  kind: 'document'
  title?: string
  /** GitHub-flavored markdown */
  body: string
  /**
   * Monotonic optimistic-revision for canvas edits (user + AI).
   * Omitted in older saves — treat as 0.
   */
  canvasRevision?: number
}

export type TabularArtifactPayload = {
  kind: 'tabular'
  title?: string
  /** e.g. linked file name — "from Budget.xlsx" */
  sourceLabel?: string
  columns: TabularColumn[]
  rows: TabularRow[]
}

/** One sheet/table block inside a multi-file canvas */
export type TabularSection = {
  title?: string
  sourceLabel?: string
  columns: TabularColumn[]
  rows: TabularRow[]
}

export type TabularMultiArtifactPayload = {
  kind: 'tabular-multi'
  title?: string
  /** Several tables at once (e.g. multiple Excel files + AI-merged result). */
  sections: TabularSection[]
}

export type VisualArtifactPayload = {
  kind: 'visual'
  title?: string
  /** User or model prompt that produced the image */
  prompt?: string
  /** https URL or `data:image/...;base64,...` when wired to image gen */
  imageSrc?: string
  alt?: string
}

/** Live workspace dashboard preview (App agent mode); reads `.braian/dashboard` from disk. */
export type AppPreviewArtifactPayload = {
  kind: 'app-preview'
}

export type WorkspaceArtifactPayload =
  | DocumentArtifactPayload
  | TabularArtifactPayload
  | TabularMultiArtifactPayload
  | VisualArtifactPayload
  | AppPreviewArtifactPayload

export function isDocumentArtifact(
  p: WorkspaceArtifactPayload,
): p is DocumentArtifactPayload {
  return p.kind === 'document'
}

export function isTabularArtifact(
  p: WorkspaceArtifactPayload,
): p is TabularArtifactPayload {
  return p.kind === 'tabular'
}

export function isTabularMultiArtifact(
  p: WorkspaceArtifactPayload,
): p is TabularMultiArtifactPayload {
  return p.kind === 'tabular-multi'
}

export function isVisualArtifact(
  p: WorkspaceArtifactPayload,
): p is VisualArtifactPayload {
  return p.kind === 'visual'
}

export function isAppPreviewArtifact(
  p: WorkspaceArtifactPayload,
): p is AppPreviewArtifactPayload {
  return p.kind === 'app-preview'
}
