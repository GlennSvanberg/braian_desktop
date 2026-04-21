import { useConvexAuth, useQuery } from 'convex/react'
import { useMemo } from 'react'

import { isCloudConfigured } from '@/lib/cloud/convex-client'
import { isCloudWorkspaceSessionId } from '@/lib/cloud/workspace'
import { isTauri } from '@/lib/tauri-env'

import { api } from '../../../convex/_generated/api'

export function useWorkspaceArrowCloudBundle(workspaceId: string | null | undefined) {
  const isCloudWeb =
    Boolean(workspaceId) &&
    !isTauri() &&
    isCloudConfigured() &&
    isCloudWorkspaceSessionId(workspaceId!)

  const { isAuthenticated, isLoading: authLoading } = useConvexAuth()
  const bundle = useQuery(
    api.arrowApps.workspaceBundle,
    isCloudWeb && isAuthenticated && !authLoading && workspaceId
      ? { workspaceClientId: workspaceId }
      : 'skip',
  )

  const inlineSourcesForApp = useMemo(() => {
    return (appId: string | null) => {
      if (!isCloudWeb || !appId || !bundle) return null
      const row = bundle.apps.find((a) => a.appId === appId)
      if (!row) return null
      const src: Record<string, string> = { 'main.ts': row.mainTs }
      if (row.mainCss.trim()) src['main.css'] = row.mainCss
      return src
    }
  }, [isCloudWeb, bundle])

  return {
    isCloudWeb,
    bundle,
    authLoading,
    isAuthenticated,
    inlineSourcesForApp,
  }
}
