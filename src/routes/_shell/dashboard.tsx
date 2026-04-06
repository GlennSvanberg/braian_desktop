import { createFileRoute, Navigate } from '@tanstack/react-router'

import { useWorkspace } from '@/components/app/workspace-context'

export const Route = createFileRoute('/_shell/dashboard')({
  component: DashboardToWebappRedirect,
})

function DashboardToWebappRedirect() {
  const { activeWorkspaceId } = useWorkspace()
  if (!activeWorkspaceId) {
    return (
      <div className="text-text-3 flex min-h-0 flex-1 flex-col items-center justify-center p-8 text-center text-sm">
        <p>Select or create a workspace to open the webapp.</p>
      </div>
    )
  }
  return (
    <Navigate
      to="/workspace/$workspaceId/webapp"
      params={{ workspaceId: activeWorkspaceId }}
      replace
    />
  )
}
