import { useConvexAuth, useQuery } from 'convex/react'
import { useEffect, useRef } from 'react'

import {
  isNonWorkspaceScopedSessionId,
  isUserProfileSessionId,
} from '@/lib/chat-sessions/detached'
import { pullArrowAppsToDisk } from '@/lib/cloud/arrow-apps-sync'
import { isCloudConfigured } from '@/lib/cloud/convex-client'
import { isTauri } from '@/lib/tauri-env'

import { api } from '../../../convex/_generated/api'

type Props = {
  activeWorkspaceId: string
}

/**
 * When cloud sync is on, subscribe to the Arrow bundle for the active folder
 * workspace and merge remote changes onto disk (desktop). Renders nothing.
 */
export function CloudArrowAppsWorkspaceSync({ activeWorkspaceId }: Props) {
  if (!isCloudConfigured() || !isTauri()) return null
  if (
    !activeWorkspaceId ||
    isNonWorkspaceScopedSessionId(activeWorkspaceId) ||
    isUserProfileSessionId(activeWorkspaceId)
  ) {
    return null
  }
  return <CloudArrowAppsWorkspaceSyncInner activeWorkspaceId={activeWorkspaceId} />
}

function CloudArrowAppsWorkspaceSyncInner({
  activeWorkspaceId,
}: {
  activeWorkspaceId: string
}) {
  const { isAuthenticated, isLoading } = useConvexAuth()
  const shouldQuery = isAuthenticated && !isLoading
  const bundle = useQuery(
    api.arrowApps.workspaceBundle,
    shouldQuery ? { workspaceClientId: activeWorkspaceId } : 'skip',
  )

  const lastSigRef = useRef<string>('')

  useEffect(() => {
    if (!bundle) return
    const sig = JSON.stringify({
      m: bundle.meta,
      a: bundle.apps.map((x) => [x.appId, x.updatedAtMs, x.mainTs.length]),
      d: bundle.deletedApps,
    })
    if (sig === lastSigRef.current) return
    lastSigRef.current = sig
    void pullArrowAppsToDisk(activeWorkspaceId)
  }, [activeWorkspaceId, bundle])

  return null
}
