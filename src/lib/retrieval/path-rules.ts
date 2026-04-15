/**
 * Rules for which workspace paths are indexed for semantic RAG.
 */

const SKIP_DIR_NAMES = new Set([
  '.braian',
  '.git',
  'node_modules',
  'target',
  'dist',
  'build',
  '.next',
  '.turbo',
  '.vite',
])

/** True if this path segment or file name should never be indexed (secrets). */
export function shouldSkipSecretsPath(relativePath: string): boolean {
  const norm = relativePath.replace(/\\/g, '/')
  const base = norm.split('/').pop() ?? ''
  const lower = base.toLowerCase()
  if (lower === '.env' || lower.startsWith('.env.')) return true
  if (lower.endsWith('.env')) return true
  return false
}

/** Skip heavy dirs when walking repo files (same idea as `workspace_list_all_files`). */
export function shouldSkipWalkDirName(dirName: string): boolean {
  return SKIP_DIR_NAMES.has(dirName)
}
