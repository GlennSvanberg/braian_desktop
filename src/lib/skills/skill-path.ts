import {
  APP_BUILDER_SKILL_FILENAME,
  CREATE_SKILL_FILENAME,
  SKILLS_DIR_RELATIVE_PATH,
} from './constants'

const SKILLS_PREFIX = `${SKILLS_DIR_RELATIVE_PATH}/`

/** Normalize to forward slashes and trim (preserve leading `.braian/…`). */
export function normalizeWorkspaceRelativePath(raw: string): string {
  return raw.trim().replace(/\\/g, '/')
}

/**
 * True if `relativePath` is a .md file under `.braian/skills/` (no .. segments).
 */
export function isAllowedSkillRelativePath(relativePath: string): boolean {
  const p = normalizeWorkspaceRelativePath(relativePath)
  if (!p.toLowerCase().endsWith('.md')) return false
  if (!p.startsWith(SKILLS_PREFIX)) return false
  if (p.includes('..')) return false
  const rest = p.slice(SKILLS_PREFIX.length)
  if (rest === '' || rest.includes('/')) return false
  return true
}

export function createSkillRelativePath(): string {
  return `${SKILLS_DIR_RELATIVE_PATH}/${CREATE_SKILL_FILENAME}`
}

export function appBuilderSkillRelativePath(): string {
  return `${SKILLS_DIR_RELATIVE_PATH}/${APP_BUILDER_SKILL_FILENAME}`
}
