import type { WorkspaceFileIndexEntry } from '@/lib/workspace-api'

const MENTION_MAX_RESULTS = 48

/** Workspace-internal store (conversations, artifacts, etc.) — never offer in @file mentions. */
function isInternalBraianPath(relativePath: string): boolean {
  const p = relativePath.replace(/\\/g, '/')
  return p === '.braian' || p.startsWith('.braian/')
}

/** Active @… mention at caret: `start` is index of `@`, `query` is text after `@`. */
export function getMentionQuery(
  draft: string,
  caret: number,
): { start: number; query: string } | null {
  if (caret < 0) return null
  const safeCaret = Math.min(caret, draft.length)
  const before = draft.slice(0, safeCaret)
  const at = before.lastIndexOf('@')
  if (at < 0) return null
  if (at > 0) {
    const prev = before[at - 1]
    if (prev !== undefined && !/[\s\n]/.test(prev)) return null
  }
  const segment = before.slice(at + 1)
  if (segment.includes('\n')) return null
  if (/[\s@]/.test(segment)) return null
  return { start: at, query: segment }
}

export function filterWorkspaceFilesForMention(
  files: WorkspaceFileIndexEntry[],
  query: string,
): WorkspaceFileIndexEntry[] {
  const q = query.trim().toLowerCase()
  const visible = files.filter((f) => !isInternalBraianPath(f.relativePath))
  const filtered =
    q === ''
      ? visible
      : visible.filter(
          (f) =>
            f.name.toLowerCase().includes(q) ||
            f.relativePath.toLowerCase().includes(q),
        )
  return filtered.slice(0, MENTION_MAX_RESULTS)
}

export function applyMentionToDraft(
  draft: string,
  caret: number,
  mentionStart: number,
  pick: WorkspaceFileIndexEntry,
): { nextDraft: string; nextCaret: number } {
  const before = draft.slice(0, mentionStart)
  const after = draft.slice(caret)
  const insert = `@${pick.name} `
  const nextDraft = before + insert + after
  const nextCaret = before.length + insert.length
  return { nextDraft, nextCaret }
}
