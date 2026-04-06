import { toolDefinition } from '@tanstack/ai'
import { z } from 'zod'

import { isNonWorkspaceScopedSessionId } from '@/lib/chat-sessions/detached'
import {
  MEMORY_RELATIVE_PATH,
  MEMORY_REVIEW_READ_MAX_BYTES,
} from '@/lib/memory/constants'
import {
  workspaceReadTextFile,
  workspaceWriteTextFile,
} from '@/lib/workspace-api'

import type { ChatTurnContext } from './types'

/** Keep in sync with `MEMORY_MD_TEMPLATE` in `src-tauri/src/braian_store.rs`. */
export const WORKSPACE_MEMORY_DEFAULT_TEMPLATE = `# Workspace memory

Durable notes for this workspace (preferences, decisions, names). Braian may append when **automatic memory update** is enabled; you can edit freely.

**Git:** This file may be committed. Do not store secrets or API keys here.

## Preferences

## Decisions

## Open questions

`

export function normalizeMemorySectionHeading(
  raw: string | undefined,
): string {
  const t = (raw ?? 'Preferences').trim().replace(/^#+\s*/, '').trim()
  return t.length > 0 ? t : 'Preferences'
}

/**
 * Appends markdown under an existing \`## Section\` or creates the section at EOF.
 */
export function appendToWorkspaceMemoryMarkdown(
  body: string,
  markdownLines: string,
  sectionHeading: string | undefined,
): string {
  const section = normalizeMemorySectionHeading(sectionHeading)
  const addition = markdownLines.trimEnd()
  if (!addition) {
    throw new Error('markdownLines must not be empty.')
  }

  const block = addition.startsWith('\n') ? addition : `\n${addition}`
  const toInsert = `${block.endsWith('\n') ? block : `${block}\n`}`

  const lines = body.length > 0 ? body.split('\n') : []
  const sectionRe = /^##\s+(.+?)\s*$/

  let sectionStart = -1
  for (let i = 0; i < lines.length; i++) {
    const m = sectionRe.exec(lines[i] ?? '')
    if (!m) continue
    if (m[1]!.trim().toLowerCase() === section.toLowerCase()) {
      sectionStart = i
      break
    }
  }

  if (sectionStart < 0) {
    const base = body.trimEnd()
    const sep = base.length > 0 && !base.endsWith('\n') ? '\n\n' : '\n'
    return `${base}${sep}## ${section}\n${toInsert}`
  }

  let sectionEnd = lines.length
  for (let j = sectionStart + 1; j < lines.length; j++) {
    if (sectionRe.test(lines[j] ?? '')) {
      sectionEnd = j
      break
    }
  }

  const before = lines.slice(0, sectionEnd).join('\n')
  const after = lines.slice(sectionEnd).join('\n')
  const needsNl = before.length > 0 && !before.endsWith('\n')
  const merged =
    (needsNl ? `${before}\n` : before) +
    toInsert +
    (after.length > 0 ? after : '')
  return merged
}

const addWorkspaceMemorySchema = z.object({
  markdownLines: z
    .string()
    .min(1)
    .describe(
      'Markdown to append (usually bullet lines). Do not include API keys or secrets.',
    ),
  sectionHeading: z
    .string()
    .optional()
    .describe(
      'Optional ## section title without hashes (e.g. Preferences, Decisions). Defaults to Preferences.',
    ),
})

const addWorkspaceMemoryTool = toolDefinition({
  name: 'add_workspace_memory',
  description: `Append durable workspace-only notes to \`${MEMORY_RELATIVE_PATH}\` (same file injected into context). Use when the user asks to remember something for **this workspace** (conventions, names, "always do X"). Prefer bullets. Do not store secrets.`,
  inputSchema: addWorkspaceMemorySchema,
})

export function buildWorkspaceMemoryTools(context: ChatTurnContext | undefined) {
  if (
    !context?.workspaceId ||
    isNonWorkspaceScopedSessionId(context.workspaceId)
  ) {
    return []
  }

  const workspaceId = context.workspaceId

  return [
    addWorkspaceMemoryTool.server(async (args) => {
      const input = addWorkspaceMemorySchema.parse(args)
      const lines = input.markdownLines.trim()
      if (!lines) {
        return { ok: false as const, error: 'markdownLines is empty.' }
      }

      let body: string
      try {
        const r = await workspaceReadTextFile(
          workspaceId,
          MEMORY_RELATIVE_PATH,
          MEMORY_REVIEW_READ_MAX_BYTES,
        )
        body = r.text
      } catch {
        body = WORKSPACE_MEMORY_DEFAULT_TEMPLATE
      }

      let next: string
      try {
        next = appendToWorkspaceMemoryMarkdown(
          body,
          input.markdownLines,
          input.sectionHeading,
        )
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return { ok: false as const, error: msg }
      }

      try {
        await workspaceWriteTextFile(
          workspaceId,
          MEMORY_RELATIVE_PATH,
          next,
        )
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return { ok: false as const, error: msg }
      }

      return {
        ok: true as const,
        message: `Appended to workspace memory (${MEMORY_RELATIVE_PATH}).`,
      }
    }),
  ]
}
