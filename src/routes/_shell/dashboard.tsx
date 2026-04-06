import { createFileRoute } from '@tanstack/react-router'

import { WorkspaceDashboard } from '@/components/app/workspace-dashboard'
import type { DashboardTab } from '@/components/app/workspace-dashboard'
import { WorkspaceFolderManagementPanel } from '@/components/app/workspace-folder-management-panel'
import { useWorkspace } from '@/components/app/workspace-context'

type DashboardSearch = {
  tab: DashboardTab
}

function parseDashboardTab(raw: Record<string, unknown>): DashboardTab {
  const t = raw.tab
  if (t === 'apps' || t === 'app-settings' || t === 'overview') {
    return t
  }
  return 'overview'
}

export const Route = createFileRoute('/_shell/dashboard')({
  validateSearch: (raw: Record<string, unknown>): DashboardSearch => ({
    tab: parseDashboardTab(raw),
  }),
  component: DashboardRoute,
})

function DashboardRoute() {
  const { tab } = Route.useSearch()
  const { activeWorkspaceId, isTauriRuntime } = useWorkspace()

  if (!activeWorkspaceId) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-auto p-4 md:p-6">
        <div className="mx-auto flex w-full max-w-lg flex-col gap-4">
          <div className="text-text-3 text-center text-sm">
            <p className="text-text-1 font-medium">No workspace yet</p>
            <p className="text-text-3/90 mt-2 text-xs leading-relaxed">
              {isTauriRuntime ? (
                <>
                  Create or add a folder below. It will show up in the sidebar and open
                  the full dashboard.
                </>
              ) : (
                <>
                  Open the desktop app to add folder workspaces on this computer.
                </>
              )}
            </p>
          </div>
          <WorkspaceFolderManagementPanel workspaceId="" />
        </div>
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
