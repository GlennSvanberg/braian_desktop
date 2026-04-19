import { api } from '../../../convex/_generated/api'

import type { ChatThreadState } from '@/lib/chat-sessions/types'
import type { ConversationSavePayload } from '@/lib/workspace-api'

import { isCloudEnabled } from './auth-state'
import { getConvexClient } from './convex-client'
import {
  diffForPush,
  type CloudConversationFields,
  type CloudThreadSnapshot,
  mergeScalarsLww,
  missingMessagesFromCloud,
  type LocalScalarOverlay,
} from './diff'
import { clearSnapshot, readSnapshot, writeSnapshot } from './snapshot-store'

/**
 * Cloud sync facade.
 *
 * Pure side-effects-on-the-cloud module. Imported from `workspace-api.ts` so
 * existing call sites (`conversationSave`, `conversationSetTitle`, etc.)
 * keep their shape - they just gain a fire-and-forget cloud mirror when
 * `isCloudEnabled()` is true.
 *
 * Concurrency model:
 * - Per-conversation FIFO queue keyed by `clientId`. Each enqueued task
 *   awaits the previous one so we never race two pushes for the same row.
 * - Failures are logged and surface no UI; the next save naturally retries
 *   because the snapshot wasn't advanced.
 *
 * What is NOT synced (V1, by design): canvasKind, artifactPayload,
 * contextFiles, contextConversations, agentMode, reasoningMode,
 * activeMcpServers, appHarnessEnabled. See the plan and `convex/schema.ts`.
 */

export { isCloudEnabled }

const queues = new Map<string, Promise<void>>()

function enqueue(clientId: string, task: () => Promise<void>): Promise<void> {
  const prev = queues.get(clientId) ?? Promise.resolve()
  const next = prev.catch(() => undefined).then(task)
  queues.set(
    clientId,
    next.finally(() => {
      if (queues.get(clientId) === next) queues.delete(clientId)
    }),
  )
  return next
}

/**
 * Mirror one local save to the cloud (no-op when signed out / not configured).
 *
 * Always returns a resolved promise so callers can `void pushConversation(...)`
 * without leaking unhandled rejections.
 */
export async function pushConversation(
  payload: ConversationSavePayload,
): Promise<void> {
  if (!isCloudEnabled()) return
  const client = getConvexClient()
  if (!client) return
  await enqueue(payload.id, async () => {
    try {
      const prev = readSnapshot(payload.id)
      const diff = diffForPush(payload, prev, Date.now())
      if (diff.upsert) {
        await client.mutation(api.conversations.upsertConversation, {
          clientId: diff.upsert.clientId,
          title: diff.upsert.title,
          pinned: diff.upsert.pinned,
          unread: diff.upsert.unread,
          draft: diff.upsert.draft,
          updatedAtMs: diff.upsert.updatedAtMs,
        })
      } else if (!prev) {
        // No snapshot yet but no scalar change either: still ensure the
        // conversation row exists before appending messages.
        await client.mutation(api.conversations.upsertConversation, {
          clientId: diff.nextSnapshot.conversation.clientId,
          title: diff.nextSnapshot.conversation.title,
          pinned: diff.nextSnapshot.conversation.pinned,
          unread: diff.nextSnapshot.conversation.unread,
          draft: diff.nextSnapshot.conversation.draft,
          updatedAtMs: diff.nextSnapshot.conversation.updatedAtMs,
        })
      }
      if (diff.appendMessages.length > 0) {
        await client.mutation(api.conversations.appendMessages, {
          conversationClientId: payload.id,
          messages: diff.appendMessages,
        })
      }
      writeSnapshot(diff.nextSnapshot)
    } catch (err) {
      console.error('[braian/cloud] pushConversation failed', err)
    }
  })
}

/**
 * Quick-action partial update used by pin / unread / title sidebar toggles.
 *
 * Sends only the fields that changed so we don't need the rest in scope.
 * The server-side `patchConversation` mutation applies LWW on `updatedAtMs`;
 * if the conversation doesn't exist remotely yet the patch is a no-op and
 * the next full `pushConversation` (from the chat workbench save loop) will
 * create it.
 */
export async function pushPartialUpdate(input: {
  clientId: string
  title?: string
  pinned?: boolean
  unread?: boolean
  draft?: string
}): Promise<void> {
  if (!isCloudEnabled()) return
  const client = getConvexClient()
  if (!client) return
  if (
    input.title === undefined &&
    input.pinned === undefined &&
    input.unread === undefined &&
    input.draft === undefined
  ) {
    return
  }
  await enqueue(input.clientId, async () => {
    try {
      const now = Date.now()
      await client.mutation(api.conversations.patchConversation, {
        clientId: input.clientId,
        updatedAtMs: now,
        title: input.title,
        pinned: input.pinned,
        unread: input.unread,
        draft: input.draft,
      })
      const prev = readSnapshot(input.clientId)
      if (prev) {
        writeSnapshot({
          conversation: {
            ...prev.conversation,
            title: input.title ?? prev.conversation.title,
            pinned: input.pinned ?? prev.conversation.pinned,
            unread: input.unread ?? prev.conversation.unread,
            draft: input.draft ?? prev.conversation.draft,
            updatedAtMs: now,
          },
          messageIds: prev.messageIds,
        })
      }
    } catch (err) {
      console.error('[braian/cloud] pushPartialUpdate failed', err)
    }
  })
}

export async function pushDelete(clientId: string): Promise<void> {
  if (!isCloudEnabled()) return
  const client = getConvexClient()
  if (!client) return
  await enqueue(clientId, async () => {
    try {
      await client.mutation(api.conversations.softDelete, {
        clientId,
        updatedAtMs: Date.now(),
      })
      clearSnapshot(clientId)
    } catch (err) {
      console.error('[braian/cloud] pushDelete failed', err)
    }
  })
}

export type CloudPullResult = {
  /** Scalar fields the local copy should adopt (LWW). */
  scalarOverlay: LocalScalarOverlay
  /** Cloud-only messages to append after local ones (in cloud order). */
  appendedMessages: Array<{
    clientMsgId: string
    role: 'user' | 'assistant'
    content: string
    status?: string
    createdAtMs?: number
  }>
  /** Convenience: the new full snapshot to persist after merging locally. */
  newSnapshot: CloudThreadSnapshot | null
}

/**
 * Pull the cloud copy of a thread and return the diff to apply locally.
 *
 * Returns an empty result when cloud is disabled or the thread doesn't exist
 * remotely yet.
 */
export async function pullConversation(
  clientId: string,
  local: {
    title: string
    pinned: boolean
    unread: boolean
    draft: string
    updatedAtMs: number
    messages: Array<{ id: string }>
  },
): Promise<CloudPullResult> {
  const empty: CloudPullResult = {
    scalarOverlay: {},
    appendedMessages: [],
    newSnapshot: null,
  }
  if (!isCloudEnabled()) return empty
  const client = getConvexClient()
  if (!client) return empty
  try {
    const remote = await client.query(api.conversations.getThread, { clientId })
    if (!remote) return empty
    const remoteFields: CloudConversationFields = {
      clientId,
      title: remote.conversation.title,
      pinned: remote.conversation.pinned,
      unread: remote.conversation.unread,
      draft: remote.conversation.draft,
      updatedAtMs: remote.conversation.updatedAtMs,
    }
    const overlay = mergeScalarsLww({ local, remote: remoteFields })
    const missing = missingMessagesFromCloud(local.messages, remote.messages)
    return {
      scalarOverlay: overlay,
      appendedMessages: missing.map((m) => ({
        clientMsgId: m.clientMsgId,
        role: m.role,
        content: m.content,
        status: m.status,
        createdAtMs: m.createdAtMs,
      })),
      newSnapshot: {
        conversation: remoteFields,
        messageIds: remote.messages.map((m) => m.clientMsgId),
      },
    }
  } catch (err) {
    console.error('[braian/cloud] pullConversation failed', err)
    return empty
  }
}

/** Apply a `CloudPullResult` onto a `ChatThreadState` snapshot. */
export function applyCloudPullToThread(
  thread: ChatThreadState,
  pull: CloudPullResult,
): ChatThreadState {
  if (
    !pull.scalarOverlay.draft &&
    !pull.appendedMessages.length &&
    pull.scalarOverlay.title === undefined &&
    pull.scalarOverlay.pinned === undefined &&
    pull.scalarOverlay.unread === undefined
  ) {
    return thread
  }
  return {
    ...thread,
    draft: pull.scalarOverlay.draft ?? thread.draft,
    messages:
      pull.appendedMessages.length === 0
        ? thread.messages
        : [
            ...thread.messages,
            ...pull.appendedMessages.map((m) =>
              m.role === 'user'
                ? {
                    id: m.clientMsgId,
                    role: 'user' as const,
                    content: m.content,
                  }
                : {
                    id: m.clientMsgId,
                    role: 'assistant' as const,
                    content: m.content,
                    status: 'complete' as const,
                  },
            ),
          ],
  }
}
