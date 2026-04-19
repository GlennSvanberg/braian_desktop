import type { ConversationSavePayload } from '@/lib/workspace-api'

/**
 * Pure data layer for the cloud sync diff.
 *
 * Lives on its own (no Convex imports) so we can unit-test the wire shape
 * without spinning up a Convex client. The `sync.ts` module wraps this with
 * the actual mutation calls, queue, and retry behavior.
 */

/** What the cloud expects per conversation row. */
export type CloudConversationFields = {
  clientId: string
  title: string
  pinned: boolean
  unread: boolean
  draft: string
  updatedAtMs: number
}

/** What the cloud expects per appended message. */
export type CloudMessageInput = {
  clientMsgId: string
  role: 'user' | 'assistant'
  content: string
  status?: string
  createdAtMs?: number
}

/**
 * Local mirror of what we believe the cloud currently holds for a thread.
 * Persisted in `localStorage` keyed by `clientId` so the diff survives
 * reloads and we don't blindly resend the whole thread on every save.
 */
export type CloudThreadSnapshot = {
  conversation: CloudConversationFields
  /** Set of message client ids we have already pushed. */
  messageIds: string[]
}

export type ConversationDiff = {
  /** When set, push this row via `upsertConversation`. */
  upsert: CloudConversationFields | null
  /** When non-empty, append via `appendMessages`. */
  appendMessages: CloudMessageInput[]
  /** Snapshot to store after the push succeeds. */
  nextSnapshot: CloudThreadSnapshot
}

function pickConversationFields(
  input: ConversationSavePayload,
  updatedAtMs: number,
): CloudConversationFields {
  return {
    clientId: input.id,
    title: input.title,
    pinned: input.pinned,
    unread: input.unread,
    draft: input.draft,
    updatedAtMs,
  }
}

function fieldsEqual(
  a: CloudConversationFields | null,
  b: CloudConversationFields,
): boolean {
  if (!a) return false
  return (
    a.title === b.title &&
    a.pinned === b.pinned &&
    a.unread === b.unread &&
    a.draft === b.draft
  )
}

/** Strip messages we should not (yet) push to the cloud. */
function isPushableMessage(m: ConversationSavePayload['messages'][number]) {
  if (m.role !== 'user' && m.role !== 'assistant') return false
  if (m.status === 'streaming') return false
  return m.content.length > 0 || m.role === 'user'
}

/**
 * Compute the minimum set of cloud writes for one local save.
 *
 * Rules:
 * - Scalar fields are upserted only when they actually changed (vs the last
 *   known cloud snapshot). The new `updatedAtMs` is `now` so the cloud-side
 *   LWW will accept it.
 * - Messages are appended only when they aren't already in the snapshot's
 *   `messageIds`. Streaming/empty assistant messages are skipped; they'll
 *   sync on the next save once they reach `complete`.
 */
export function diffForPush(
  payload: ConversationSavePayload,
  prevSnapshot: CloudThreadSnapshot | null,
  now: number,
): ConversationDiff {
  const newFields = pickConversationFields(payload, now)
  const knownIds = new Set(prevSnapshot?.messageIds ?? [])
  const append: CloudMessageInput[] = []
  const allPushedIds: string[] = [...(prevSnapshot?.messageIds ?? [])]
  for (const m of payload.messages) {
    if (!isPushableMessage(m)) continue
    if (knownIds.has(m.id)) continue
    append.push({
      clientMsgId: m.id,
      role: m.role as 'user' | 'assistant',
      content: m.content,
      status: m.status,
    })
    knownIds.add(m.id)
    allPushedIds.push(m.id)
  }
  const fieldsChanged = !fieldsEqual(prevSnapshot?.conversation ?? null, newFields)
  return {
    upsert: fieldsChanged ? newFields : null,
    appendMessages: append,
    nextSnapshot: {
      conversation: newFields,
      messageIds: allPushedIds,
    },
  }
}

/**
 * Apply scalar LWW between a remote conversation and the local persisted
 * payload. Returns a partial overwrite to push back into the local copy.
 */
export type LocalScalarOverlay = {
  title?: string
  pinned?: boolean
  unread?: boolean
  draft?: string
}

export function mergeScalarsLww(args: {
  local: { title: string; pinned: boolean; unread: boolean; draft: string; updatedAtMs: number }
  remote: CloudConversationFields
}): LocalScalarOverlay {
  if (args.remote.updatedAtMs <= args.local.updatedAtMs) return {}
  const overlay: LocalScalarOverlay = {}
  if (args.remote.title !== args.local.title) overlay.title = args.remote.title
  if (args.remote.pinned !== args.local.pinned) overlay.pinned = args.remote.pinned
  if (args.remote.unread !== args.local.unread) overlay.unread = args.remote.unread
  if (args.remote.draft !== args.local.draft) overlay.draft = args.remote.draft
  return overlay
}

/**
 * Compute messages present on the cloud but missing locally (by id).
 * Caller appends them at the end of the local message list, preserving the
 * server's `orderKey` order.
 */
export function missingMessagesFromCloud<
  Local extends { id: string },
  Remote extends { clientMsgId: string },
>(localMessages: Local[], remoteMessages: Remote[]): Remote[] {
  const known = new Set(localMessages.map((m) => m.id))
  return remoteMessages.filter((m) => !known.has(m.clientMsgId))
}
