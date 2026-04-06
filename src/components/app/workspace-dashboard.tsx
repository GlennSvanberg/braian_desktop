import { useNavigate } from '@tanstack/react-router'

import { WorkspaceWebappPanel } from '@/components/app/workspace-webapp-panel'
import { WorkspaceWebappSettingsPanel } from '@/components/app/workspace-webapp-settings-panel'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

export type DashboardTab = 'apps' | 'app-settings'

type Props = {
  tab: DashboardTab
  workspaceId: string
  isTauriRuntime: boolean
}

export function WorkspaceDashboard({
  tab,
  workspaceId,
  isTauriRuntime,
}: Props) {
  const navigate = useNavigate()

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="border-border shrink-0 border-b px-4 pt-3 pb-0 md:px-6">
        <Tabs
          value={tab}
          onValueChange={(v) => {
            void navigate({
              to: '/dashboard',
              search: { tab: v as DashboardTab },
              replace: true,
            })
          }}
        >
          <TabsList
            variant="line"
            className="h-auto w-full justify-start gap-1 rounded-none bg-transparent p-0"
          >
            <TabsTrigger value="apps">Apps</TabsTrigger>
            <TabsTrigger value="app-settings">App settings</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {tab === 'apps' ? (
          <WorkspaceWebappPanel
            workspaceId={workspaceId}
            isTauriRuntime={isTauriRuntime}
            className="min-h-0 flex-1"
          />
        ) : (
          <WorkspaceWebappSettingsPanel
            workspaceId={workspaceId}
            isTauriRuntime={isTauriRuntime}
            className="min-h-0 flex-1"
          />
        )}
      </div>
    </div>
  )
}
