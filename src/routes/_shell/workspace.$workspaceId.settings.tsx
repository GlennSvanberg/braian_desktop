import { createFileRoute } from '@tanstack/react-router'

import { WorkspaceSettingsScreen } from '@/components/app/workspace-settings-screen'
import { useWorkspace } from '@/components/app/workspace-context'

export const Route = createFileRoute('/_shell/workspace/$workspaceId/settings')({
  component: WorkspaceSettingsRoute,
})

function WorkspaceSettingsRoute() {
  const { workspaceId } = Route.useParams()
  const { isTauriRuntime } = useWorkspace()
  return (
    <WorkspaceSettingsScreen
      workspaceId={workspaceId}
      isTauriRuntime={isTauriRuntime}
    />
  )
}
