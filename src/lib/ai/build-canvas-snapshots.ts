import { getDocumentCanvasLivePayload } from '@/lib/ai/document-canvas-live'
import type {
  DocumentCanvasSnapshot,
  WorkspaceFileCanvasSnapshot,
} from '@/lib/ai/types'
import { getWorkspaceFileCanvasLivePayload } from '@/lib/ai/workspace-file-canvas-live'
import { artifactTabLabel, canvasLiveScopeKey } from '@/lib/chat-sessions/artifact-tabs'
import type { ChatThreadState } from '@/lib/chat-sessions/types'
import { isUserProfileSessionId } from '@/lib/chat-sessions/detached'

import type { DocumentCanvasSelectionContext } from './types'

export type CanvasSnapshotsForTurn = {
  documentCanvasSnapshot: DocumentCanvasSnapshot | null
  workspaceFileCanvasSnapshot: WorkspaceFileCanvasSnapshot | null
}

export type ArtifactTabsSummaryEntry = {
  id: string
  kind: string
  label?: string
}

export function buildArtifactTabsSummary(
  thread: Pick<ChatThreadState, 'artifactTabs'>,
): ArtifactTabsSummaryEntry[] {
  return thread.artifactTabs.map((t) => ({
    id: t.id,
    kind: t.payload.kind,
    label: artifactTabLabel(t),
  }))
}

/**
 * Live document/file buffers for the focused tab (composite scope key).
 */
export function buildCanvasSnapshotsForTurn(options: {
  sessionKey: string
  workspaceId: string
  thread: ChatThreadState
  selectionForTurn?: DocumentCanvasSelectionContext | undefined
  selectionUserInstruction?: string | undefined
}): CanvasSnapshotsForTurn {
  const {
    sessionKey,
    workspaceId,
    thread,
    selectionForTurn,
    selectionUserInstruction,
  } = options

  const ap = thread.activeArtifactTabId
    ? thread.artifactTabs.find((t) => t.id === thread.activeArtifactTabId)
        ?.payload ?? null
    : null

  const scope = canvasLiveScopeKey(
    sessionKey,
    thread.activeArtifactTabId,
  )
  const live = getDocumentCanvasLivePayload(scope)
  const wfLive = getWorkspaceFileCanvasLivePayload(scope)

  const documentCanvasSnapshot =
    isUserProfileSessionId(workspaceId)
      ? null
      : ap?.kind === 'document'
        ? {
            body: live?.body ?? ap.body,
            ...(ap.title !== undefined && ap.title !== ''
              ? { title: ap.title }
              : {}),
            revision: ap.canvasRevision ?? 0,
            ...(selectionForTurn
              ? {
                  selection: selectionForTurn,
                  selectionUserInstruction,
                }
              : {}),
          }
        : null

  const workspaceFileCanvasSnapshot =
    isUserProfileSessionId(workspaceId)
      ? null
      : ap?.kind === 'workspace-file'
        ? {
            relativePath: ap.relativePath,
            body: wfLive?.body ?? ap.body,
            revision: ap.canvasRevision ?? 0,
            ...(ap.truncated === true ? { truncated: true as const } : {}),
            ...(ap.title !== undefined && ap.title !== ''
              ? { title: ap.title }
              : {}),
          }
        : null

  return {
    documentCanvasSnapshot,
    workspaceFileCanvasSnapshot,
  }
}
