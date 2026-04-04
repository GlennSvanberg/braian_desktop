import { isTauri } from '@/lib/tauri-env'
import { workspaceListDir, workspaceReadTextFile } from '@/lib/workspace-api'

import {
  APP_BUILDER_SKILL_FILENAME,
  SKILL_CATALOG_MAX_FILES,
  SKILL_CATALOG_READ_MAX_BYTES,
  SKILLS_DIR_RELATIVE_PATH,
} from './constants'
import { parseSkillMarkdown } from './parse-skill-md'
import { createSkillRelativePath } from './skill-path'

export type SkillCatalogEntry = {
  relativePath: string
  name: string
  description: string
}

export type SkillCatalogLoadResult = {
  entries: SkillCatalogEntry[]
  /** True if listing/reading failed (e.g. desktop only) or directory missing. */
  catalogIncomplete: boolean
}

/**
 * Shallow scan of `.braian/skills/*.md` for frontmatter name + description.
 */
export async function loadSkillCatalog(
  workspaceId: string,
): Promise<SkillCatalogLoadResult> {
  if (!isTauri()) {
    return { entries: [], catalogIncomplete: true }
  }
  try {
    const dir = await workspaceListDir(workspaceId, SKILLS_DIR_RELATIVE_PATH)
    const mdFiles = dir
      .filter((e) => !e.isDir && e.name.toLowerCase().endsWith('.md'))
      .slice(0, SKILL_CATALOG_MAX_FILES)

    const entries: SkillCatalogEntry[] = []
    for (const e of mdFiles) {
      try {
        const { text } = await workspaceReadTextFile(
          workspaceId,
          e.relativePath,
          SKILL_CATALOG_READ_MAX_BYTES,
        )
        const parsed = parseSkillMarkdown(text)
        if (parsed.ok) {
          entries.push({
            relativePath: e.relativePath,
            name: parsed.frontmatter.name,
            description: parsed.frontmatter.description,
          })
        } else {
          entries.push({
            relativePath: e.relativePath,
            name: e.name,
            description: `[Invalid frontmatter: ${parsed.message}]`,
          })
        }
      } catch {
        entries.push({
          relativePath: e.relativePath,
          name: e.name,
          description: '[Could not read file.]',
        })
      }
    }
    return { entries, catalogIncomplete: false }
  } catch {
    return { entries: [], catalogIncomplete: true }
  }
}

export function formatSkillCatalogSystemText(
  entries: SkillCatalogEntry[],
  catalogIncomplete: boolean,
): string {
  const lines: string[] = [
    'Workspace skills under `.braian/skills/` (metadata only — use `read_workspace_skill` for full bodies).',
    '',
  ]
  if (catalogIncomplete) {
    lines.push(
      '[Catalog could not be loaded (e.g. web preview or missing folder). Tools may still work in the desktop app.]',
      '',
    )
  }
  if (entries.length === 0) {
    lines.push('_(No skill files found.)_')
    return lines.join('\n')
  }
  for (const e of entries) {
    lines.push(`- **${e.name}** (\`${e.relativePath}\`): ${e.description}`)
  }
  return lines.join('\n')
}

/**
 * Full markdown body of create-skill (after frontmatter), for system injection.
 */
export async function loadCreateSkillBodyMarkdown(
  workspaceId: string,
  fallbackBody: string,
): Promise<string> {
  if (!isTauri()) {
    return fallbackBody
  }
  try {
    const path = createSkillRelativePath()
    const { text } = await workspaceReadTextFile(
      workspaceId,
      path,
      SKILL_CATALOG_READ_MAX_BYTES,
    )
    const parsed = parseSkillMarkdown(text)
    if (!parsed.ok) {
      return fallbackBody
    }
    return parsed.body.trim() || fallbackBody
  } catch {
    return fallbackBody
  }
}

export async function loadAppBuilderSkillMarkdown(
  workspaceId: string,
  fallback: string,
): Promise<string> {
  if (!isTauri()) {
    return fallback
  }
  try {
    const rel = `${SKILLS_DIR_RELATIVE_PATH}/${APP_BUILDER_SKILL_FILENAME}`
    const { text } = await workspaceReadTextFile(
      workspaceId,
      rel,
      SKILL_CATALOG_READ_MAX_BYTES * 2,
    )
    const parsed = parseSkillMarkdown(text)
    if (!parsed.ok) {
      return fallback
    }
    const body = parsed.body.trim()
    return body || fallback
  } catch {
    return fallback
  }
}
