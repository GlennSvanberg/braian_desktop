import {
  APP_BUILDER_SKILL_DIRNAME,
  APP_BUILDER_SKILL_LEGACY_FILENAME,
  CREATE_SKILL_DIRNAME,
  CREATE_SKILL_LEGACY_FILENAME,
  SKILL_MD_FILENAME,
  SKILLS_DIR_RELATIVE_PATH,
} from './constants'

const SKILLS_PREFIX = `${SKILLS_DIR_RELATIVE_PATH}/`

/** Normalize to forward slashes and trim (preserve leading `.braian/…`). */
export function normalizeWorkspaceRelativePath(raw: string): string {
  return raw.trim().replace(/\\/g, '/')
}

/**
 * True if `relativePath` is a top-level legacy .md file under `.braian/skills/`.
 */
export function isLegacySkillRelativePath(relativePath: string): boolean {
  const p = normalizeWorkspaceRelativePath(relativePath)
  if (!p.toLowerCase().endsWith('.md')) return false
  if (!p.startsWith(SKILLS_PREFIX)) return false
  if (p.includes('..')) return false
  const rest = p.slice(SKILLS_PREFIX.length)
  if (rest === '' || rest.includes('/')) return false
  return true
}

/**
 * True if `relativePath` points to `.braian/skills/<slug>/SKILL.md`.
 */
export function isSkillMainPath(relativePath: string): boolean {
  const p = normalizeWorkspaceRelativePath(relativePath)
  if (!p.startsWith(SKILLS_PREFIX) || p.includes('..')) return false
  const rest = p.slice(SKILLS_PREFIX.length)
  const parts = rest.split('/').filter(Boolean)
  if (parts.length !== 2) return false
  const [slug, filename] = parts
  return slug.length > 0 && filename.toLowerCase() === SKILL_MD_FILENAME.toLowerCase()
}

/**
 * True if `relativePath` points inside one skill directory.
 */
export function isSkillBundlePath(relativePath: string): boolean {
  const p = normalizeWorkspaceRelativePath(relativePath)
  if (!p.startsWith(SKILLS_PREFIX) || p.includes('..')) return false
  const rest = p.slice(SKILLS_PREFIX.length)
  const parts = rest.split('/').filter(Boolean)
  if (parts.length < 2) return false
  return parts[0].length > 0
}

/**
 * Resolve user/tool path argument to canonical skill path.
 * Accepts:
 * - `slug` -> `.braian/skills/slug/SKILL.md`
 * - `slug/SKILL.md` or `slug/references/foo.md`
 * - full workspace-relative paths under `.braian/skills/`
 * - legacy `name.md` top-level files
 */
export function resolveSkillPathArg(raw: string): string | null {
  const n = normalizeWorkspaceRelativePath(raw)
  if (!n) return null
  if (isSkillBundlePath(n) || isLegacySkillRelativePath(n)) return n
  if (n.includes('..')) return null
  if (n.startsWith(SKILLS_PREFIX)) return null

  // Bare slug: "create-skill"
  if (!n.includes('/') && !n.toLowerCase().endsWith('.md')) {
    return `${SKILLS_PREFIX}${n}/${SKILL_MD_FILENAME}`
  }

  // Skill-relative bundle path: "create-skill/SKILL.md" or "create-skill/references/x.md"
  if (n.includes('/')) {
    return `${SKILLS_PREFIX}${n}`
  }

  // Legacy shorthand: "create-skill.md"
  if (n.toLowerCase().endsWith('.md')) {
    return `${SKILLS_PREFIX}${n.replace(/^.*\//, '')}`
  }
  return null
}

export function createSkillRelativePath(): string {
  return `${SKILLS_DIR_RELATIVE_PATH}/${CREATE_SKILL_DIRNAME}/${SKILL_MD_FILENAME}`
}

export function appBuilderSkillRelativePath(): string {
  return `${SKILLS_DIR_RELATIVE_PATH}/${APP_BUILDER_SKILL_DIRNAME}/${SKILL_MD_FILENAME}`
}

export function createSkillLegacyRelativePath(): string {
  return `${SKILLS_DIR_RELATIVE_PATH}/${CREATE_SKILL_LEGACY_FILENAME}`
}

export function appBuilderSkillLegacyRelativePath(): string {
  return `${SKILLS_DIR_RELATIVE_PATH}/${APP_BUILDER_SKILL_LEGACY_FILENAME}`
}
