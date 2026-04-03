/**
 * Workspace canvas payloads — discriminated union the real LLM/tools should emit.
 * User-facing labels: Document, Data, Visual (avoid "artifact" in UI).
 */
export type ArtifactKind = 'document' | 'tabular' | 'visual'

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
  /** Plain text; future: markdown */
  body: string
}

export type TabularArtifactPayload = {
  kind: 'tabular'
  title?: string
  /** e.g. linked file name — "from Budget.xlsx" */
  sourceLabel?: string
  columns: TabularColumn[]
  rows: TabularRow[]
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

export type WorkspaceArtifactPayload =
  | DocumentArtifactPayload
  | TabularArtifactPayload
  | VisualArtifactPayload

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

export function isVisualArtifact(
  p: WorkspaceArtifactPayload,
): p is VisualArtifactPayload {
  return p.kind === 'visual'
}
