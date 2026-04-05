import {
  applyTextPatches,
  type TextReplacement,
  type ApplyTextPatchesResult,
} from './text-patches'

export type DocumentCanvasReplacement = TextReplacement

export type ApplyDocumentCanvasPatchesOk = {
  ok: true
  markdown: string
}

export type ApplyDocumentCanvasPatchesErr = {
  ok: false
  error: string
  code: 'EMPTY_FIND' | 'NOT_FOUND' | 'AMBIGUOUS'
}

export type ApplyDocumentCanvasPatchesResult =
  | ApplyDocumentCanvasPatchesOk
  | ApplyDocumentCanvasPatchesErr

/**
 * Apply ordered search/replace operations on markdown. Each step runs on the result of the previous step.
 * - Default: `find` must appear exactly once.
 * - `replaceAll: true`: replace all disjoint matches for that step (left-to-right).
 */
export function applyDocumentCanvasPatches(
  markdown: string,
  replacements: DocumentCanvasReplacement[],
): ApplyDocumentCanvasPatchesResult {
  const result: ApplyTextPatchesResult = applyTextPatches(
    markdown,
    replacements,
  )
  if (!result.ok) {
    return result
  }
  return { ok: true, markdown: result.text }
}
