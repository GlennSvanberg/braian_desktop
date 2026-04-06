import { toolDefinition } from '@tanstack/ai'
import { z } from 'zod'

import type { Tool } from '@tanstack/ai'

import { isNonWorkspaceScopedSessionId } from '@/lib/chat-sessions/detached'
import { SKILLS_DIR_RELATIVE_PATH } from '@/lib/skills/constants'
import type { SkillCatalogEntry } from '@/lib/skills/load-skill-catalog'
import { loadSkillCatalog } from '@/lib/skills/load-skill-catalog'
import { parseSkillMarkdown } from '@/lib/skills/parse-skill-md'
import {
  isLegacySkillRelativePath,
  isSkillMainPath,
  resolveSkillPathArg,
} from '@/lib/skills/skill-path'
import { workspaceReadTextFile, workspaceWriteTextFile } from '@/lib/workspace-api'

import type { ChatTurnContext } from './types'

const listSchema = z.object({})

const readSchema = z.object({
  path: z
    .string()
    .describe(
      `Skill id or path under ${SKILLS_DIR_RELATIVE_PATH}/. Examples: create-skill, create-skill/SKILL.md, create-skill/references/best-practices.md, or ${SKILLS_DIR_RELATIVE_PATH}/create-skill/SKILL.md.`,
    ),
})

const writeSchema = z.object({
  path: z
    .string()
    .describe(
      `Target skill path under ${SKILLS_DIR_RELATIVE_PATH}/. Examples: create-skill, create-skill/SKILL.md, create-skill/references/checklist.md, or legacy create-skill.md.`,
    ),
  content: z
    .string()
    .describe('UTF-8 content to write. For SKILL.md and legacy top-level .md files, content must include valid frontmatter (name, description).'),
})

export function buildSkillTools(context: ChatTurnContext | undefined): Tool[] {
  if (
    !context?.workspaceId ||
    isNonWorkspaceScopedSessionId(context.workspaceId)
  ) {
    return []
  }
  const workspaceId = context.workspaceId

  const listTool = toolDefinition({
    name: 'list_workspace_skills',
    description: `List workspace skills under \`${SKILLS_DIR_RELATIVE_PATH}/\` (name, description, path to SKILL.md or legacy .md).`,
    inputSchema: listSchema,
  }).server(async () => {
    listSchema.parse({})
    const { entries, catalogIncomplete } = await loadSkillCatalog(workspaceId)
    const payload: { skills: SkillCatalogEntry[]; catalogIncomplete: boolean } =
      {
        skills: entries,
        catalogIncomplete,
      }
    return JSON.stringify(payload)
  })

  const readTool = toolDefinition({
    name: 'read_workspace_skill',
    description:
      'Read skill instructions or bundled skill resources under `.braian/skills/`. For SKILL.md/legacy .md returns frontmatter and body; for other files returns raw text.',
    inputSchema: readSchema,
  }).server(async (args) => {
    const { path: rawPath } = readSchema.parse(args)
    const rel = resolveSkillPathArg(rawPath)
    if (!rel) {
      return JSON.stringify({
        ok: false as const,
        error: 'Path must stay under .braian/skills/ and cannot contain ..',
      })
    }
    try {
      const { text, truncated } = await workspaceReadTextFile(
        workspaceId,
        rel,
        null,
      )
      if (isSkillMainPath(rel) || isLegacySkillRelativePath(rel)) {
        const parsed = parseSkillMarkdown(text)
        if (!parsed.ok) {
          return JSON.stringify({
            ok: false as const,
            path: rel,
            error: parsed.message,
            preview: text.slice(0, 2000),
          })
        }
        return JSON.stringify({
          ok: true as const,
          path: rel,
          kind: 'skill' as const,
          name: parsed.frontmatter.name,
          description: parsed.frontmatter.description,
          body: parsed.body,
          truncated,
        })
      }
      return JSON.stringify({
        ok: true as const,
        path: rel,
        kind: 'resource' as const,
        content: text,
        truncated,
      })
    } catch (e) {
      return JSON.stringify({
        ok: false as const,
        error: e instanceof Error ? e.message : String(e),
      })
    }
  })

  const writeTool = toolDefinition({
    name: 'write_workspace_skill',
    description: `Create or replace files under \`${SKILLS_DIR_RELATIVE_PATH}/\`. SKILL.md (or legacy top-level .md) must include valid frontmatter (\`name\`, \`description\`); bundled files can contain arbitrary UTF-8 content.`,
    inputSchema: writeSchema,
  }).server(async (args) => {
    const { path: rawPath, content } = writeSchema.parse(args)
    const rel = resolveSkillPathArg(rawPath)
    if (!rel) {
      return JSON.stringify({
        ok: false as const,
        error: 'Path must stay under .braian/skills/ and cannot contain ..',
      })
    }
    const shouldValidateFrontmatter =
      isSkillMainPath(rel) || isLegacySkillRelativePath(rel)
    let parsedName: string | null = null
    if (shouldValidateFrontmatter) {
      const parsed = parseSkillMarkdown(content)
      if (!parsed.ok) {
        return JSON.stringify({
          ok: false as const,
          error: `Invalid skill markdown: ${parsed.message}`,
        })
      }
      parsedName = parsed.frontmatter.name
    }
    try {
      await workspaceWriteTextFile(workspaceId, rel, content)
      return JSON.stringify({
        ok: true as const,
        path: rel,
        kind: shouldValidateFrontmatter ? ('skill' as const) : ('resource' as const),
        name: parsedName,
      })
    } catch (e) {
      return JSON.stringify({
        ok: false as const,
        error: e instanceof Error ? e.message : String(e),
      })
    }
  })

  return [listTool, readTool, writeTool]
}
