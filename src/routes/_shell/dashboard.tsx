import { createFileRoute } from '@tanstack/react-router'

import { WorkspaceDashboard } from '@/components/app/workspace-dashboard'
import { useWorkspace } from '@/components/app/workspace-context'

type DashboardSearch = {
  tab: 'apps' | 'app-settings'
}

export const Route = createFileRoute('/_shell/dashboard')({
  validateSearch: (raw: Record<string, unknown>): DashboardSearch => ({
    tab: raw.tab === 'app-settings' ? 'app-settings' : 'apps',
  }),
  component: DashboardRoute,
})

function DashboardRoute() {
  const { tab } = Route.useSearch()
  const { activeWorkspaceId, isTauriRuntime } = useWorkspace()

  if (!activeWorkspaceId) {
    return (
      <div className="text-text-3 flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-sm">
        <p>Select or create a workspace to open the dashboard.</p>
        <p className="text-text-3/80 max-w-sm text-xs leading-relaxed">
          Use <span className="text-text-2 font-medium">Manage workspaces</span> in the
          footer to add a folder.
        </p>
      </div>
    )
  }

  return (
    <WorkspaceDashboard
      tab={tab}
      workspaceId={activeWorkspaceId}
      isTauriRuntime={isTauriRuntime}
    />
  )
}
