import { createFileRoute } from '@tanstack/react-router'

import { WorkspaceSettingsScreen } from '@/components/app/workspace-settings-screen'

export const Route = createFileRoute('/_shell/workspace/$workspaceId/settings')({
  component: WorkspaceSettingsRoute,
})

function WorkspaceSettingsRoute() {
  const { workspaceId } = Route.useParams()
  return <WorkspaceSettingsScreen workspaceId={workspaceId} />
}
