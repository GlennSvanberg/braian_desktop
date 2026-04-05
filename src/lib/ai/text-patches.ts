export type TextReplacement = {
  find: string
  replace: string
  replaceAll?: boolean
}

export type ApplyTextPatchesOk = {
  ok: true
  text: string
}

export type ApplyTextPatchesErr = {
  ok: false
  error: string
  code: 'EMPTY_FIND' | 'NOT_FOUND' | 'AMBIGUOUS'
}

export type ApplyTextPatchesResult = ApplyTextPatchesOk | ApplyTextPatchesErr

/**
 * Apply ordered search/replace operations on a text string.
 * Each step runs on the result of the previous step.
 * - Default: `find` must appear exactly once.
 * - `replaceAll: true`: replace all disjoint matches for that step (left-to-right).
 */
export function applyTextPatches(
  text: string,
  replacements: TextReplacement[],
): ApplyTextPatchesResult {
  let current = text

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
          error: `Replacement ${i + 1}: find text not found.`,
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
        error: `Replacement ${i + 1}: find text not found.`,
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

  return { ok: true, text: current }
}
