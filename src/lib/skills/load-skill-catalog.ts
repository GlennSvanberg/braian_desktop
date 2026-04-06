import { isTauri } from '@/lib/tauri-env'
import { workspaceListDir, workspaceReadTextFile } from '@/lib/workspace-api'

import {
  SKILL_MD_FILENAME,
  SKILL_CATALOG_MAX_FILES,
  SKILL_CATALOG_READ_MAX_BYTES,
  SKILLS_DIR_RELATIVE_PATH,
} from './constants'
import { parseSkillMarkdown } from './parse-skill-md'
import {
  appBuilderSkillLegacyRelativePath,
  appBuilderSkillRelativePath,
} from './skill-path'

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
 * Scan `.braian/skills/` for canonical `<slug>/SKILL.md` plus legacy flat `.md` files.
 */
export async function loadSkillCatalog(
  workspaceId: string,
): Promise<SkillCatalogLoadResult> {
  if (!isTauri()) {
    return { entries: [], catalogIncomplete: true }
  }
  try {
    const dirEntries = await workspaceListDir(workspaceId, SKILLS_DIR_RELATIVE_PATH)
    const records = new Map<string, SkillCatalogEntry>()

    const upsert = (entry: SkillCatalogEntry, prefer = false) => {
      const key = entry.name.trim().toLowerCase()
      if (!key) return
      if (prefer || !records.has(key)) {
        records.set(key, entry)
      }
    }

    // Canonical format: `.braian/skills/<slug>/SKILL.md`
    const skillDirs = dirEntries.filter((e) => e.isDir).slice(0, SKILL_CATALOG_MAX_FILES)
    for (const d of skillDirs) {
      const mainPath = `${d.relativePath}/${SKILL_MD_FILENAME}`
      try {
        const { text } = await workspaceReadTextFile(
          workspaceId,
          mainPath,
          SKILL_CATALOG_READ_MAX_BYTES,
        )
        const parsed = parseSkillMarkdown(text)
        if (parsed.ok) {
          upsert(
            {
              relativePath: mainPath,
              name: parsed.frontmatter.name,
              description: parsed.frontmatter.description,
            },
            true,
          )
          continue
        }
        upsert(
          {
            relativePath: mainPath,
            name: d.name,
            description: `[Invalid frontmatter: ${parsed.message}]`,
          },
          true,
        )
      } catch {
        // Directory exists but no readable SKILL.md; ignore.
      }
    }

    // Legacy flat format: `.braian/skills/<name>.md`
    const legacyMdFiles = dirEntries
      .filter((e) => !e.isDir && e.name.toLowerCase().endsWith('.md'))
      .slice(0, SKILL_CATALOG_MAX_FILES)
    for (const e of legacyMdFiles) {
      try {
        const { text } = await workspaceReadTextFile(
          workspaceId,
          e.relativePath,
          SKILL_CATALOG_READ_MAX_BYTES,
        )
        const parsed = parseSkillMarkdown(text)
        if (parsed.ok) {
          upsert({
            relativePath: e.relativePath,
            name: parsed.frontmatter.name,
            description: parsed.frontmatter.description,
          })
        } else {
          upsert({
            relativePath: e.relativePath,
            name: e.name,
            description: `[Invalid frontmatter: ${parsed.message}]`,
          })
        }
      } catch {
        upsert({
          relativePath: e.relativePath,
          name: e.name,
          description: '[Could not read file.]',
        })
      }
    }

    return {
      entries: Array.from(records.values()),
      catalogIncomplete: false,
    }
  } catch {
    return { entries: [], catalogIncomplete: true }
  }
}

export function formatSkillCatalogSystemText(
  entries: SkillCatalogEntry[],
  catalogIncomplete: boolean,
): string {
  const lines: string[] = [
    '## Skills catalog',
    '',
    'Skills live under `.braian/skills/`, usually as `.braian/skills/<slug>/SKILL.md` with optional bundled files (for example `references/` or `scripts/`). Call `read_workspace_skill` before following a skill.',
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

export async function loadAppBuilderSkillMarkdown(
  workspaceId: string,
  fallback: string,
): Promise<string> {
  if (!isTauri()) {
    return fallback
  }
  try {
    const { text } = await workspaceReadTextFile(
      workspaceId,
      appBuilderSkillRelativePath(),
      SKILL_CATALOG_READ_MAX_BYTES * 2,
    )
    const parsed = parseSkillMarkdown(text)
    if (!parsed.ok) {
      throw new Error(parsed.message)
    }
    const body = parsed.body.trim()
    return body || fallback
  } catch {
    // Backward compatibility for pre-migration workspaces.
    try {
      const { text } = await workspaceReadTextFile(
        workspaceId,
        appBuilderSkillLegacyRelativePath(),
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
}
