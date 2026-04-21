import { useEffect, useRef } from 'react'
import { useConvexAuth } from 'convex/react'

import {
  backfillLocalArrowAppsToCloud,
  backfillLocalConversationsToCloud,
} from '@/lib/cloud/backfill'
import { isCloudConfigured } from '@/lib/cloud/convex-client'
import { isTauri } from '@/lib/tauri-env'

/**
 * On the first authenticated render of the desktop app, walk every local
 * conversation and push it to Convex. Subsequent renders are guarded by a
 * ref so we never re-scan within the same session.
 *
 * Renders nothing. Mounted under `<CloudAuthProvider>` so `useConvexAuth`
 * works; no-op when cloud isn't configured or we're running in the web build.
 */
export function CloudInitialBackfill() {
  if (!isCloudConfigured() || !isTauri()) return null
  return <CloudInitialBackfillInner />
}

function CloudInitialBackfillInner() {
  const { isAuthenticated, isLoading } = useConvexAuth()
  const ranRef = useRef(false)

  useEffect(() => {
    if (!isAuthenticated || isLoading) return
    if (ranRef.current) return
    ranRef.current = true
    void (async () => {
      try {
        const result = await backfillLocalConversationsToCloud()
        if (result.scanned > 0) {
          console.info(
            `[braian/cloud] backfill complete: scanned=${result.scanned} pushed=${result.pushed} failed=${result.failed}`,
          )
        }
        const arrow = await backfillLocalArrowAppsToCloud()
        if (arrow.workspaces > 0) {
          console.info(
            `[braian/cloud] arrow backfill: workspaces=${arrow.workspaces} failed=${arrow.failed}`,
          )
        }
      } catch (err) {
        console.error('[braian/cloud] backfill failed', err)
        ranRef.current = false
      }
    })()
  }, [isAuthenticated, isLoading])

  return null
}
