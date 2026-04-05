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
        to: '/workspace/$workspaceId/settings',
        params: { workspaceId: activeWorkspaceId },
        replace: true,
      })
    } else {
      void navigate({ to: '/dashboard', replace: true })
    }
  }, [loading, activeWorkspaceId, navigate])

  return (
    <div className="text-text-3 p-4 text-sm">
      Redirecting to workspace settings…
    </div>
  )
}
