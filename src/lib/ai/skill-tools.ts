import { toolDefinition } from '@tanstack/ai'
import { z } from 'zod'

import type { Tool } from '@tanstack/ai'

import { isNonWorkspaceScopedSessionId } from '@/lib/chat-sessions/detached'
import { SKILLS_DIR_RELATIVE_PATH } from '@/lib/skills/constants'
import type { SkillCatalogEntry } from '@/lib/skills/load-skill-catalog'
import { loadSkillCatalog } from '@/lib/skills/load-skill-catalog'
import { parseSkillMarkdown } from '@/lib/skills/parse-skill-md'
import {
  isAllowedSkillRelativePath,
  normalizeWorkspaceRelativePath,
} from '@/lib/skills/skill-path'
import { workspaceReadTextFile, workspaceWriteTextFile } from '@/lib/workspace-api'

import type { ChatTurnContext } from './types'

const listSchema = z.object({})

const readSchema = z.object({
  path: z
    .string()
    .describe(
      `Relative path to a skill file under ${SKILLS_DIR_RELATIVE_PATH}/ (e.g. create-skill.md or ${SKILLS_DIR_RELATIVE_PATH}/create-skill.md).`,
    ),
})

const writeSchema = z.object({
  path: z
    .string()
    .describe(
      `Target path: basename like create-skill.md or full path ${SKILLS_DIR_RELATIVE_PATH}/<name>.md`,
    ),
  content: z
    .string()
    .describe('Full UTF-8 Markdown file including YAML frontmatter and body.'),
})

function resolveSkillPathArg(raw: string): string | null {
  const n = normalizeWorkspaceRelativePath(raw)
  if (isAllowedSkillRelativePath(n)) return n
  const base = n.replace(/^.*\//, '')
  if (!base.toLowerCase().endsWith('.md')) return null
  if (base.includes('..') || base.includes('/') || base.includes('\\'))
    return null
  return `${SKILLS_DIR_RELATIVE_PATH}/${base}`
}

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
    description: `List workspace skills under \`${SKILLS_DIR_RELATIVE_PATH}/\` (name, description, path). Same metadata as the system catalog; use for refresh mid-conversation.`,
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
      'Read one skill Markdown file under `.braian/skills/`. Returns frontmatter metadata and body text.',
    inputSchema: readSchema,
  }).server(async (args) => {
    const { path: rawPath } = readSchema.parse(args)
    const rel = resolveSkillPathArg(rawPath)
    if (!rel || !isAllowedSkillRelativePath(rel)) {
      return JSON.stringify({
        ok: false as const,
        error:
          'Path must be a .md file directly under .braian/skills/ (no subfolders or ..).',
      })
    }
    try {
      const { text, truncated } = await workspaceReadTextFile(
        workspaceId,
        rel,
        null,
      )
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
        name: parsed.frontmatter.name,
        description: parsed.frontmatter.description,
        body: parsed.body,
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
    description: `Create or replace a UTF-8 Markdown skill under \`${SKILLS_DIR_RELATIVE_PATH}/\`. Content must include valid YAML frontmatter (\`name\`, \`description\`) and a Markdown body. Parent directories are created if needed.`,
    inputSchema: writeSchema,
  }).server(async (args) => {
    const { path: rawPath, content } = writeSchema.parse(args)
    const rel = resolveSkillPathArg(rawPath)
    if (!rel || !isAllowedSkillRelativePath(rel)) {
      return JSON.stringify({
        ok: false as const,
        error:
          'Path must be a .md file directly under .braian/skills/ (no subfolders or ..).',
      })
    }
    const parsed = parseSkillMarkdown(content)
    if (!parsed.ok) {
      return JSON.stringify({
        ok: false as const,
        error: `Invalid skill markdown: ${parsed.message}`,
      })
    }
    try {
      await workspaceWriteTextFile(workspaceId, rel, content)
      return JSON.stringify({
        ok: true as const,
        path: rel,
        name: parsed.frontmatter.name,
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
