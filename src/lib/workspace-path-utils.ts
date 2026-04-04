/** Normalize to forward slashes for comparisons (Windows-safe). */
export function normalizeFsPath(p: string): string {
  return p.replace(/\\/g, '/')
}

/**
 * Strip the Win32 verbatim extended path prefix for display and human-facing copy.
 * e.g. `\\?\C:\git\foo` → `C:\git\foo`, `\\?\UNC\server\share` → `\\server\share`
 */
export function formatPathForDisplay(p: string): string {
  if (!p) return p
  if (!p.startsWith('\\\\?\\')) return p
  const norm = p.replace(/\//g, '\\')
  const rest = norm.slice(4)
  if (rest.toUpperCase().startsWith('UNC\\')) {
    return `\\\\${rest.slice(4)}`
  }
  return rest
}

export function isPathUnderRoot(filePath: string, rootPath: string): boolean {
  const f = normalizeFsPath(filePath).toLowerCase()
  const r = normalizeFsPath(rootPath).replace(/\/+$/, '').toLowerCase()
  return f === r || f.startsWith(`${r}/`)
}

/** Relative path using forward slashes; empty string if `filePath` equals root. */
export function relativePathFromRoot(
  filePath: string,
  rootPath: string,
): string {
  const f = normalizeFsPath(filePath)
  const r = normalizeFsPath(rootPath).replace(/\/+$/, '')
  const fl = f.toLowerCase()
  const rl = r.toLowerCase()
  if (fl === rl) return ''
  const prefix = `${rl}/`
  if (!fl.startsWith(prefix)) {
    throw new Error('File is not under the workspace folder.')
  }
  return f.slice(prefix.length)
}

/** Join workspace root with a relative path for OS APIs (e.g. reveal in folder). */
export function joinRootRelative(rootPath: string, relativePath: string): string {
  const sep = rootPath.includes('\\') ? '\\' : '/'
  const r = rootPath.replace(/[/\\]+$/, '')
  const rel = relativePath.replace(/^[/\\]+/, '').replace(/\//g, sep)
  return rel ? `${r}${sep}${rel}` : r
}

export function parentRelativeDir(relativeDir: string): string {
  const parts = normalizeFsPath(relativeDir)
    .split('/')
    .filter((s) => s.length > 0)
  parts.pop()
  return parts.join('/')
}
