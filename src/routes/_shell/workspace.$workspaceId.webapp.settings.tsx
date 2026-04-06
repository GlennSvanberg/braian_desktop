import { createFileRoute } from '@tanstack/react-router'

import { WorkspaceWebappSettingsPanel } from '@/components/app/workspace-webapp-settings-panel'
import { useWorkspace } from '@/components/app/workspace-context'

export const Route = createFileRoute(
  '/_shell/workspace/$workspaceId/webapp/settings',
)({
  component: WorkspaceWebappSettingsRoute,
})

function WorkspaceWebappSettingsRoute() {
  const { workspaceId } = Route.useParams()
  const { isTauriRuntime } = useWorkspace()

  return (
    <WorkspaceWebappSettingsPanel
      workspaceId={workspaceId}
      isTauriRuntime={isTauriRuntime}
      className="min-h-0 flex-1"
    />
  )
}
