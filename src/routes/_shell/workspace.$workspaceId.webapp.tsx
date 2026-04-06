import { createFileRoute, Outlet, useRouterState } from '@tanstack/react-router'

import { WorkspaceWebappPanel } from '@/components/app/workspace-webapp-panel'
import { useWorkspace } from '@/components/app/workspace-context'

export const Route = createFileRoute('/_shell/workspace/$workspaceId/webapp')({
  component: WorkspaceWebappRoute,
})

function WorkspaceWebappRoute() {
  const { workspaceId } = Route.useParams()
  const { isTauriRuntime } = useWorkspace()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const settingsPath = `/workspace/${workspaceId}/webapp/settings`
  const isWebappSettings = pathname === settingsPath

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {isWebappSettings ? (
        <Outlet />
      ) : (
        <WorkspaceWebappPanel
          workspaceId={workspaceId}
          isTauriRuntime={isTauriRuntime}
          className="min-h-0 flex-1"
        />
      )}
    </div>
  )
}
