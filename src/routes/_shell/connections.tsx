import { useEffect } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'

import { useWorkspace } from '@/components/app/workspace-context'

/**
 * Legacy global URL; Connections now live under per-workspace settings.
 */
export const Route = createFileRoute('/_shell/connections')({
  component: ConnectionsRedirect,
})

function ConnectionsRedirect() {
  const navigate = useNavigate()
  const { activeWorkspaceId, loading } = useWorkspace()

  useEffect(() => {
    if (loading) return
    if (activeWorkspaceId) {
      void navigate({
        to: '/dashboard',
        search: { tab: 'workspace-settings' },
        replace: true,
      })
    } else {
      void navigate({
        to: '/dashboard',
        search: { tab: 'overview' },
        replace: true,
      })
    }
  }, [loading, activeWorkspaceId, navigate])

  return (
    <div className="text-text-3 p-4 text-sm">
      Redirecting to workspace settings…
    </div>
  )
}
