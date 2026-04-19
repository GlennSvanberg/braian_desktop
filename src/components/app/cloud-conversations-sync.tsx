import { useEffect } from 'react'
import { useConvexAuth, useQuery } from 'convex/react'

import { CLOUD_WORKSPACE_SESSION_ID } from '@/lib/cloud/workspace'
import { isCloudConfigured } from '@/lib/cloud/convex-client'

import { api } from '../../../convex/_generated/api'

import type { WorkspaceConversation } from './workspace-context'

type CloudConversationDoc = {
  clientId: string
  title: string
  pinned: boolean
  unread: boolean
  draft: string
  updatedAtMs: number
}

type Props = {
  /**
   * Replace the cloud-bucket entry in the workspace conversation map. The
   * provider owns the actual map; we just push the latest cloud snapshot in.
   */
  onCloudList: (rows: WorkspaceConversation[]) => void
}

/**
 * Subscribe to `listMine` while signed in and forward the result to the
 * `WorkspaceProvider`. Renders nothing.
 *
 * Mounted conditionally from the provider so we don't spin up a Convex
 * subscription when cloud sync is disabled or the user is signed out.
 */
export function CloudConversationsSync({ onCloudList }: Props) {
  if (!isCloudConfigured()) return null
  return <CloudConversationsSyncInner onCloudList={onCloudList} />
}

function CloudConversationsSyncInner({ onCloudList }: Props) {
  const { isAuthenticated, isLoading } = useConvexAuth()
  const shouldQuery = isAuthenticated && !isLoading
  const rows = useQuery(api.conversations.listMine, shouldQuery ? {} : 'skip')

  useEffect(() => {
    if (!isAuthenticated) {
      onCloudList([])
      return
    }
    if (!rows) return
    const mapped = (rows as CloudConversationDoc[]).map((r) => mapRow(r))
    mapped.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return b.updatedAtMs - a.updatedAtMs
    })
    onCloudList(mapped)
  }, [rows, isAuthenticated, onCloudList])

  return null
}

function mapRow(row: CloudConversationDoc): WorkspaceConversation {
  return {
    id: row.clientId,
    workspaceId: CLOUD_WORKSPACE_SESSION_ID,
    title: row.title || 'Untitled chat',
    updatedAtMs: row.updatedAtMs,
    canvasKind: 'document',
    pinned: row.pinned,
    unread: row.unread,
    updatedLabel: '',
  }
}
