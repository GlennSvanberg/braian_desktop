import {
  conversationList,
  conversationOpen,
  workspaceList,
  type ConversationOpenResult,
  type ConversationSavePayload,
} from '@/lib/workspace-api'

import { pushConversation } from './sync'

/**
 * Build a `ConversationSavePayload` from an open result for cloud push.
 *
 * Only the fields cloud sync actually mirrors (title, pinned, unread, draft,
 * messages) need to be accurate. The rest are filled with sensible defaults
 * so the payload type-checks; the cloud diff layer ignores them.
 */
function payloadFromOpenResult(
  open: ConversationOpenResult,
): ConversationSavePayload {
  const { conversation, thread } = open
  return {
    id: conversation.id,
    workspaceId: conversation.workspaceId,
    title: conversation.title,
    canvasKind: conversation.canvasKind,
    pinned: conversation.pinned,
    unread: conversation.unread,
    artifactOpen: !!thread.activeArtifactTabId,
    artifactPanelCollapsed: thread.artifactPanelCollapsed,
    draft: thread.draft,
    messages: thread.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      status: 'status' in m ? m.status : undefined,
    })),
    // Cloud sync does not push artifactPayload (V1 scope); a `null` here is
    // safe because the diff layer ignores this field entirely.
    artifactPayload: null,
    contextFiles: thread.contextFiles ?? [],
    contextConversations: thread.contextConversations ?? [],
    agentMode: thread.agentMode,
    appHarnessEnabled: thread.agentMode === 'app',
    reasoningMode: thread.reasoningMode,
    activeMcpServers: thread.activeMcpServers ?? [],
  }
}

/**
 * One-time per-session backfill that walks every local conversation and
 * pushes it to the cloud.
 *
 * Cheap to re-run because `pushConversation` diffs against the per-thread
 * snapshot in `localStorage` and skips work when nothing changed. Intended to
 * be invoked once after auth flips to authenticated on desktop, so the user's
 * existing local-only chats show up immediately on their other devices
 * without requiring them to edit each chat first.
 */
export async function backfillLocalConversationsToCloud(): Promise<{
  scanned: number
  pushed: number
  failed: number
}> {
  let scanned = 0
  let pushed = 0
  let failed = 0
  let workspaces
  try {
    workspaces = await workspaceList()
  } catch (err) {
    console.error('[braian/cloud] backfill workspaceList failed', err)
    return { scanned, pushed, failed }
  }
  for (const ws of workspaces) {
    let conversations
    try {
      conversations = await conversationList(ws.id)
    } catch (err) {
      console.error('[braian/cloud] backfill conversationList failed', ws.id, err)
      continue
    }
    for (const meta of conversations) {
      scanned += 1
      try {
        const open = await conversationOpen(meta.id)
        if (!open) continue
        await pushConversation(payloadFromOpenResult(open))
        pushed += 1
      } catch (err) {
        failed += 1
        console.error('[braian/cloud] backfill push failed', meta.id, err)
      }
    }
  }
  return { scanned, pushed, failed }
}
