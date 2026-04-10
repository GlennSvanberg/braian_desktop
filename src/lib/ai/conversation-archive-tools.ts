import { toolDefinition } from '@tanstack/ai'
import { z } from 'zod'

import { isNonWorkspaceScopedSessionId } from '@/lib/chat-sessions/detached'
import { readConversationSummaryFile } from '@/lib/conversation/working-memory'
import {
  CONVERSATION_TRANSCRIPT_READ_MAX_BYTES,
  conversationSummaryRelativePath,
  conversationTranscriptRelativePath,
} from '@/lib/memory/constants'
import { workspaceReadTextFile } from '@/lib/workspace-api'

import type { ChatTurnContext } from './types'

const transcriptMessageSchema = z.object({
  id: z.string(),
  role: z.string(),
  content: z.string(),
})

const transcriptFileSchema = z
  .object({
    id: z.string(),
    messages: z.array(transcriptMessageSchema),
  })
  .passthrough()

export type TranscriptMessageRow = z.infer<typeof transcriptMessageSchema>

export type ParsedConversationTranscript = {
  conversationId: string
  messages: TranscriptMessageRow[]
}

export function parseConversationTranscriptJson(
  rawJson: string,
): ParsedConversationTranscript {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawJson) as unknown
  } catch {
    throw new Error('Conversation file is not valid JSON.')
  }
  const file = transcriptFileSchema.parse(parsed)
  return { conversationId: file.id, messages: file.messages }
}

const EXCERPT_RADIUS = 160
const MAX_EXCERPT_LEN = 480

function excerptAroundMatch(text: string, needleLower: string): string {
  const t = text
  const lower = t.toLowerCase()
  const idx = lower.indexOf(needleLower)
  if (idx < 0) {
    const slice = t.slice(0, MAX_EXCERPT_LEN)
    return t.length > MAX_EXCERPT_LEN ? `${slice}…` : slice
  }
  const start = Math.max(0, idx - EXCERPT_RADIUS)
  const end = Math.min(t.length, idx + needleLower.length + EXCERPT_RADIUS)
  let out = t.slice(start, end)
  if (start > 0) out = `…${out}`
  if (end < t.length) out = `${out}…`
  if (out.length > MAX_EXCERPT_LEN) {
    out = `${out.slice(0, MAX_EXCERPT_LEN)}…`
  }
  return out
}

function contentMatchesQuery(content: string, query: string): boolean {
  const q = query.trim()
  if (!q) return false
  const lower = content.toLowerCase()
  const qLower = q.toLowerCase()
  if (lower.includes(qLower)) return true
  const words = qLower.split(/\s+/).filter((w) => w.length > 0)
  if (words.length <= 1) return false
  return words.every((w) => lower.includes(w))
}

export type SearchHit = {
  messageId: string
  role: string
  excerpt: string
}

/**
 * Lexical search over message bodies: full phrase first, else all words (AND).
 */
export function searchConversationMessages(
  messages: ReadonlyArray<TranscriptMessageRow>,
  query: string,
  maxResults: number,
): SearchHit[] {
  const q = query.trim()
  if (!q || maxResults < 1) return []

  const qLower = q.toLowerCase()
  const words = qLower.split(/\s+/).filter((w) => w.length > 0)
  const needleForExcerpt = words.length > 0 ? words[0]! : qLower

  const hits: SearchHit[] = []
  for (const m of messages) {
    if (!contentMatchesQuery(m.content, q)) continue
    hits.push({
      messageId: m.id,
      role: m.role,
      excerpt: excerptAroundMatch(m.content, needleForExcerpt),
    })
    if (hits.length >= maxResults) break
  }
  return hits
}

export type OpenSpanRow = {
  messageId: string
  role: string
  content: string
}

export function openConversationMessagesByIds(
  messages: ReadonlyArray<TranscriptMessageRow>,
  messageIds: string[],
  maxContentCharsPerMessage: number,
): { found: OpenSpanRow[]; missingIds: string[] } {
  const idSet = new Set(messageIds)
  const byId = new Map(messages.map((m) => [m.id, m] as const))
  const missingIds: string[] = []
  for (const id of messageIds) {
    if (!byId.has(id)) missingIds.push(id)
  }

  const found: OpenSpanRow[] = []
  for (const m of messages) {
    if (!idSet.has(m.id)) continue
    let content = m.content
    if (content.length > maxContentCharsPerMessage) {
      content = `${content.slice(0, maxContentCharsPerMessage)}…`
    }
    found.push({
      messageId: m.id,
      role: m.role,
      content,
    })
  }
  return { found, missingIds }
}

const searchSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe(
      'Phrase or keywords to find in this conversation transcript (case-insensitive).',
    ),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(40)
    .optional()
    .describe('Max matching messages to return (default 15).'),
})

const openSpanSchema = z.object({
  messageIds: z
    .array(z.string().min(1))
    .min(1)
    .max(24)
    .describe(
      'Message ids from this conversation (e.g. from search_conversation_archive or the UI). Order in the transcript is preserved in the response.',
    ),
})

const getConversationSummarySchema = z.object({})

const searchConversationArchiveTool = toolDefinition({
  name: 'search_conversation_archive',
  description: `Search the **full saved transcript** of the **current** chat for text that may have been omitted from the recent message list (token budget). Use when the user asks about something said earlier or you need detail not in the visible thread. Returns short excerpts with message ids — call open_conversation_span for full text.`,
  inputSchema: searchSchema,
})

const openConversationSpanTool = toolDefinition({
  name: 'open_conversation_span',
  description: `Load full message text from the **current** conversation transcript by message id (use after search_conversation_archive). Messages are returned in **chronological order**.`,
  inputSchema: openSpanSchema,
})

const getConversationSummaryTool = toolDefinition({
  name: 'get_conversation_summary',
  description: `Read the persisted **rolling summary** file for the current chat (summary text, open loops, important decisions, covered message ids). Path: \`.braian/conversation-summaries/<conversation-id>.summary.json\`.`,
  inputSchema: getConversationSummarySchema,
})

const MAX_CONTENT_CHARS_PER_MESSAGE = 120_000

export function buildConversationArchiveTools(
  context: ChatTurnContext | undefined,
) {
  if (
    !context?.workspaceId ||
    isNonWorkspaceScopedSessionId(context.workspaceId)
  ) {
    return []
  }

  const conversationId = context.conversationId
  if (!conversationId) {
    return []
  }

  const workspaceId = context.workspaceId
  const relPath = conversationTranscriptRelativePath(conversationId)

  return [
    searchConversationArchiveTool.server(async (args) => {
      const input = searchSchema.parse(args)
      const maxResults = input.maxResults ?? 15

      let text: string
      let truncated: boolean
      try {
        const r = await workspaceReadTextFile(
          workspaceId,
          relPath,
          CONVERSATION_TRANSCRIPT_READ_MAX_BYTES,
        )
        text = r.text
        truncated = r.truncated
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return {
          ok: false as const,
          error: `Could not read transcript: ${msg}`,
        }
      }

      if (truncated) {
        return {
          ok: false as const,
          error:
            'Conversation file exceeds the maximum read size; archive search is unavailable for this thread.',
        }
      }

      let parsed: ParsedConversationTranscript
      try {
        parsed = parseConversationTranscriptJson(text)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return {
          ok: false as const,
          error: `Could not parse transcript: ${msg}`,
        }
      }

      if (parsed.conversationId !== conversationId) {
        return {
          ok: false as const,
          error: 'Conversation file id mismatch.',
        }
      }

      const hits = searchConversationMessages(
        parsed.messages,
        input.query,
        maxResults,
      )

      return {
        ok: true as const,
        conversationId,
        transcriptPath: relPath,
        matchCount: hits.length,
        hits,
      }
    }),

    openConversationSpanTool.server(async (args) => {
      const input = openSpanSchema.parse(args)

      let text: string
      let truncated: boolean
      try {
        const r = await workspaceReadTextFile(
          workspaceId,
          relPath,
          CONVERSATION_TRANSCRIPT_READ_MAX_BYTES,
        )
        text = r.text
        truncated = r.truncated
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return {
          ok: false as const,
          error: `Could not read transcript: ${msg}`,
        }
      }

      if (truncated) {
        return {
          ok: false as const,
          error:
            'Conversation file exceeds the maximum read size; cannot load messages for this thread.',
        }
      }

      let parsed: ParsedConversationTranscript
      try {
        parsed = parseConversationTranscriptJson(text)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return {
          ok: false as const,
          error: `Could not parse transcript: ${msg}`,
        }
      }

      if (parsed.conversationId !== conversationId) {
        return {
          ok: false as const,
          error: 'Conversation file id mismatch.',
        }
      }

      const { found, missingIds } = openConversationMessagesByIds(
        parsed.messages,
        input.messageIds,
        MAX_CONTENT_CHARS_PER_MESSAGE,
      )

      return {
        ok: true as const,
        conversationId,
        transcriptPath: relPath,
        messages: found,
        missingIds,
      }
    }),

    getConversationSummaryTool.server(async (args) => {
      getConversationSummarySchema.parse(args)
      const summaryPath = conversationSummaryRelativePath(conversationId)
      const file = await readConversationSummaryFile(workspaceId, conversationId)
      if (!file) {
        return {
          ok: false as const,
          error:
            'No summary file yet for this conversation (or file is invalid).',
          summaryPath,
        }
      }
      return {
        ok: true as const,
        conversationId,
        summaryPath,
        updatedAt: file.updatedAt,
        summary: file.summary,
        openLoops: file.openLoops,
        importantDecisions: file.importantDecisions,
        coveredMessageIds: file.coveredMessageIds,
      }
    }),
  ]
}
