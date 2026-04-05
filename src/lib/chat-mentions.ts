import {
  filterWorkspaceFilesForMention,
  getMentionQuery,
} from '@/lib/chat-mention-files'
import type { ConversationDto, WorkspaceFileIndexEntry } from '@/lib/workspace-api'

const MENTION_MAX_TOTAL = 48

export type MentionFilePick = { kind: 'file'; file: WorkspaceFileIndexEntry }
export type MentionChatPick = { kind: 'chat'; conversation: ConversationDto }
export type MentionPick = MentionFilePick | MentionChatPick

export { getMentionQuery }

export function filterConversationsForMention(
  conversations: ConversationDto[],
  query: string,
  excludeConversationId: string | null,
): ConversationDto[] {
  const q = query.trim().toLowerCase()
  const visible = conversations.filter(
    (c) =>
      excludeConversationId == null || c.id !== excludeConversationId,
  )
  const filtered =
    q === ''
      ? visible
      : visible.filter(
          (c) =>
            c.title.toLowerCase().includes(q) || c.id.toLowerCase().includes(q),
        )
  return filtered
}

/** Flat list for keyboard navigation: files first, then chats (each group capped). */
export function buildMentionPickList(
  files: WorkspaceFileIndexEntry[],
  conversations: ConversationDto[],
  query: string,
  excludeConversationId: string | null,
): MentionPick[] {
  const fileRows = filterWorkspaceFilesForMention(files, query).slice(
    0,
    MENTION_MAX_TOTAL,
  )
  const room = Math.max(0, MENTION_MAX_TOTAL - fileRows.length)
  const chatRows = filterConversationsForMention(
    conversations,
    query,
    excludeConversationId,
  ).slice(0, room)
  const out: MentionPick[] = []
  for (const f of fileRows) out.push({ kind: 'file', file: f })
  for (const c of chatRows) out.push({ kind: 'chat', conversation: c })
  return out
}

export function mentionPickLabel(pick: MentionPick): string {
  return pick.kind === 'file' ? pick.file.name : pick.conversation.title
}

export function applyMentionPickToDraft(
  draft: string,
  caret: number,
  mentionStart: number,
  pick: MentionPick,
): { nextDraft: string; nextCaret: number } {
  const before = draft.slice(0, mentionStart)
  const after = draft.slice(caret)
  const label = mentionPickLabel(pick)
  const insert = `@${label} `
  const nextDraft = before + insert + after
  const nextCaret = before.length + insert.length
  return { nextDraft, nextCaret }
}
