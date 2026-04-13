import { toolDefinition } from '@tanstack/ai'
import { z } from 'zod'

import { isNonWorkspaceScopedSessionId } from '@/lib/chat-sessions/detached'
import {
  createWorkspaceMemoryEntry,
  rememberWorkspaceMemoryEntry,
} from '@/lib/memory/semantic-store'

import type { ChatTurnContext } from './types'

export function normalizeMemorySectionHeading(
  raw: string | undefined,
): string {
  const t = (raw ?? 'Preferences').trim().replace(/^#+\s*/, '').trim()
  return t.length > 0 ? t : 'Preferences'
}

function sectionHeadingToSemanticKind(
  sectionHeading: string | undefined,
): 'fact' | 'preference' | 'decision' {
  const s = normalizeMemorySectionHeading(sectionHeading).toLowerCase()
  if (s === 'decisions') return 'decision'
  if (s === 'preferences') return 'preference'
  return 'fact'
}

const addWorkspaceMemorySchema = z.object({
  markdownLines: z
    .string()
    .min(1)
    .describe(
      'Markdown to store (usually bullet lines). Becomes a structured memory entry. Do not include API keys or secrets.',
    ),
  sectionHeading: z
    .string()
    .optional()
    .describe(
      'Optional section title without hashes (e.g. Preferences, Decisions). Maps to structured memory kind.',
    ),
})

const addWorkspaceMemoryTool = toolDefinition({
  name: 'add_workspace_memory',
  description: `Add durable workspace-only notes as **structured memory** JSON under \`.braian/memory/\`. Use when the user asks to remember something for **this workspace** (conventions, names, "always do X"). Prefer bullets. Do not store secrets.`,
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
  const conversationId = context.conversationId

  return [
    addWorkspaceMemoryTool.server(async (args) => {
      const input = addWorkspaceMemorySchema.parse(args)
      const lines = input.markdownLines.trim()
      if (!lines) {
        return { ok: false as const, error: 'markdownLines is empty.' }
      }

      const kind = sectionHeadingToSemanticKind(input.sectionHeading)
      const r =
        kind === 'preference' || kind === 'fact'
          ? await rememberWorkspaceMemoryEntry(workspaceId, {
              kind,
              text: lines,
              conversationId,
            })
          : await createWorkspaceMemoryEntry(workspaceId, {
              kind: 'decision',
              text: lines,
              conversationId,
            })

      if (!r.ok) {
        return { ok: false as const, error: r.error }
      }

      return {
        ok: true as const,
        message: `Saved structured workspace memory (${r.relativePath}).`,
      }
    }),
  ]
}
