export type DocumentCanvasReplacement = {
  find: string
  replace: string
  /** When true, replace every non-overlapping occurrence; default single replace. */
  replaceAll?: boolean
}

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
  let current = markdown

  for (let i = 0; i < replacements.length; i++) {
    const op = replacements[i]
    const find = op.find
    if (find.length === 0) {
      return {
        ok: false,
        code: 'EMPTY_FIND',
        error: `Replacement ${i + 1}: "find" must be a non-empty exact substring.`,
      }
    }

    if (op.replaceAll) {
      if (!current.includes(find)) {
        return {
          ok: false,
          code: 'NOT_FOUND',
          error: `Replacement ${i + 1}: find text not found in document.`,
        }
      }
      current = current.split(find).join(op.replace)
      continue
    }

    const first = current.indexOf(find)
    if (first === -1) {
      return {
        ok: false,
        code: 'NOT_FOUND',
        error: `Replacement ${i + 1}: find text not found in document.`,
      }
    }
    const second = current.indexOf(find, first + find.length)
    if (second !== -1) {
      return {
        ok: false,
        code: 'AMBIGUOUS',
        error: `Replacement ${i + 1}: find text matches multiple times; widen the snippet, set replaceAll, or add earlier replacements to disambiguate.`,
      }
    }
    current =
      current.slice(0, first) + op.replace + current.slice(first + find.length)
  }

  return { ok: true, markdown: current }
}
