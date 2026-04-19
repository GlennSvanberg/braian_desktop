import { useEffect, useRef } from 'react'
import { useConvexAuth, useQuery } from 'convex/react'

import { chatSessionKey } from '@/lib/chat-sessions/keys'
import {
  getThreadIfLoaded,
  replaceThread,
} from '@/lib/chat-sessions/store'
import type { ChatMessage, ChatThreadState } from '@/lib/chat-sessions/types'
import { isCloudConfigured } from '@/lib/cloud/convex-client'
import { writeSnapshot } from '@/lib/cloud/snapshot-store'

import { api } from '../../../convex/_generated/api'

type Props = {
  conversationId: string | null
  workspaceId: string | null
}

/**
 * Realtime cross-device sync for the *active* thread.
 *
 * Mirrors what `CloudConversationsSync` does for the sidebar list, but for
 * the messages of the conversation the user is currently viewing. When a
 * message arrives from another client (e.g. the web app), Convex pushes the
 * updated `getThread` result here and we splice the new messages into the
 * local Zustand store so the UI updates immediately.
 *
 * Renders nothing.
 *
 * Safety:
 * - Skips merges while the local thread is `generating` so we never disturb
 *   an in-flight stream.
 * - Append-only by `clientMsgId`; never edits or deletes existing messages.
 * - On Tauri, the existing autosave loop in `ChatWorkbench` picks up the
 *   merged state and writes it to disk on the next change cycle.
 */
export function CloudActiveThreadSync({ conversationId, workspaceId }: Props) {
  if (!isCloudConfigured()) return null
  if (!conversationId || !workspaceId) return null
  return (
    <CloudActiveThreadSyncInner
      conversationId={conversationId}
      workspaceId={workspaceId}
    />
  )
}

function CloudActiveThreadSyncInner({
  conversationId,
  workspaceId,
}: {
  conversationId: string
  workspaceId: string
}) {
  const { isAuthenticated, isLoading } = useConvexAuth()
  const shouldQuery = isAuthenticated && !isLoading

  // `useQuery` re-renders whenever the server sends a new value (Convex's
  // built-in realtime subscription). When `skip` flips to a real arg, the
  // subscription auto-attaches.
  const remote = useQuery(
    api.conversations.getThread,
    shouldQuery ? { clientId: conversationId } : 'skip',
  )

  const lastSeenIdsRef = useRef<string>('')

  useEffect(() => {
    if (!remote) return
    const sessionKey = chatSessionKey(workspaceId, conversationId)
    const local = getThreadIfLoaded(sessionKey)
    if (!local) return
    if (local.generating) return

    const remoteIds = remote.messages.map((m) => m.clientMsgId)
    const remoteIdSetKey = remoteIds.join('|')

    const localIdSet = new Set(local.messages.map((m) => m.id))
    const missing = remote.messages.filter(
      (m) => !localIdSet.has(m.clientMsgId),
    )

    const titleChanged = remote.conversation.title !== '' &&
      remote.conversation.updatedAtMs > 0 &&
      remote.conversation.title !== (local as ChatThreadState & { title?: string }).title

    if (missing.length === 0 && remoteIdSetKey === lastSeenIdsRef.current) {
      // Nothing new since the last server push. (Title/scalar changes are
      // handled by the sidebar listMine subscription.)
      void titleChanged
      return
    }
    lastSeenIdsRef.current = remoteIdSetKey

    if (missing.length === 0) return

    const appended: ChatMessage[] = missing.map((m) =>
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
    )

    const next: ChatThreadState = {
      ...local,
      messages: [...local.messages, ...appended],
    }
    replaceThread(sessionKey, next)

    // Keep the snapshot in lockstep with what we just merged so the next
    // outbound diff (when the user types a reply) doesn't try to re-push
    // these messages.
    writeSnapshot({
      conversation: {
        clientId: conversationId,
        title: remote.conversation.title,
        pinned: remote.conversation.pinned,
        unread: remote.conversation.unread,
        draft: remote.conversation.draft,
        updatedAtMs: remote.conversation.updatedAtMs,
      },
      messageIds: remoteIds,
    })

    console.info(
      '[braian/cloud] active thread sync: merged',
      appended.length,
      'message(s) from cloud',
      { conversationId },
    )
  }, [remote, conversationId, workspaceId])

  return null
}
