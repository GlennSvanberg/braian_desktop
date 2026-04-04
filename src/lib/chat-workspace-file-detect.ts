/** Normalize workspace-relative path from markdown / model output. */
export function normalizeWorkspaceRelativePath(s: string): string {
  return s
    .trim()
    .replace(/^[/\\]+/, '')
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
}

/**
 * Heuristic: single-segment or nested path with a file extension, safe-ish characters.
 * Used to offer workspace file actions on assistant markdown (inline or fenced code).
 */
export function looksLikeRelativeWorkspacePath(s: string): boolean {
  const t = normalizeWorkspaceRelativePath(s)
  if (t.length === 0 || t.length > 512) return false
  if (/\s/.test(t)) return false
  if (t.includes('..')) return false
  if (t.startsWith('/') || /^[A-Za-z]:[\\/]/.test(t)) return false
  const segments = t.split('/')
  const base = segments[segments.length - 1] ?? ''
  if (!base.includes('.')) return false
  const ext = base.split('.').pop() ?? ''
  if (ext.length < 1 || ext.length > 12) return false
  if (!/^[\w.-]+$/i.test(base)) return false
  if (!/^[\w./-]+$/i.test(t)) return false
  return true
}
