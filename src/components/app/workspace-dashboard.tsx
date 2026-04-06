import type { ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'

import { WorkspaceHubOverview } from '@/components/app/workspace-hub-overview'
import { WorkspaceSettingsScreen } from '@/components/app/workspace-settings-screen'
import { WorkspaceWebappPanel } from '@/components/app/workspace-webapp-panel'
import { WorkspaceWebappSettingsPanel } from '@/components/app/workspace-webapp-settings-panel'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

import { useWorkspace } from './workspace-context'

export type DashboardTab =
  | 'overview'
  | 'apps'
  | 'app-settings'
  | 'workspace-settings'

function parseDashboardTabValue(t: unknown): DashboardTab {
  if (
    t === 'apps' ||
    t === 'app-settings' ||
    t === 'overview' ||
    t === 'workspace-settings'
  ) {
    return t
  }
  return 'overview'
}

export function parseDashboardTab(raw: Record<string, unknown>): DashboardTab {
  return parseDashboardTabValue(raw.tab)
}

export function parseDashboardTabFromSearchStr(searchStr: string): DashboardTab {
  const raw = searchStr.startsWith('?') ? searchStr.slice(1) : searchStr
  return parseDashboardTabValue(new URLSearchParams(raw).get('tab'))
}

const dashboardTabTriggerClass = cn(
  'rounded-md px-3 py-2',
  'data-[state=active]:after:opacity-0',
  'data-[state=active]:!bg-primary data-[state=active]:!text-primary-foreground',
  'dark:data-[state=active]:!bg-primary dark:data-[state=active]:!text-primary-foreground',
  'data-[state=inactive]:text-foreground/60 hover:data-[state=inactive]:text-foreground',
  'dark:data-[state=inactive]:text-muted-foreground dark:hover:data-[state=inactive]:text-foreground',
)

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
  const { activeWorkspace, conversationsByWorkspace } = useWorkspace()
  const workspaceName = activeWorkspace?.name ?? 'Workspace'
  const conversations = conversationsByWorkspace[workspaceId] ?? []

  let body: ReactNode
  if (tab === 'overview') {
    body = (
      <WorkspaceHubOverview
        workspaceId={workspaceId}
        workspaceName={workspaceName}
        isTauriRuntime={isTauriRuntime}
        conversations={conversations}
      />
    )
  } else if (tab === 'apps') {
    body = (
      <WorkspaceWebappPanel
        workspaceId={workspaceId}
        isTauriRuntime={isTauriRuntime}
        className="min-h-0 flex-1"
      />
    )
  } else if (tab === 'app-settings') {
    body = (
      <WorkspaceWebappSettingsPanel
        workspaceId={workspaceId}
        isTauriRuntime={isTauriRuntime}
        className="min-h-0 flex-1"
      />
    )
  } else {
    body = <WorkspaceSettingsScreen workspaceId={workspaceId} />
  }

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
            <TabsTrigger
              value="overview"
              className={dashboardTabTriggerClass}
            >
              Dashboard
            </TabsTrigger>
            <TabsTrigger value="apps" className={dashboardTabTriggerClass}>
              Apps
            </TabsTrigger>
            <TabsTrigger
              value="app-settings"
              className={dashboardTabTriggerClass}
            >
              App settings
            </TabsTrigger>
            <TabsTrigger
              value="workspace-settings"
              className={dashboardTabTriggerClass}
            >
              Workspace settings
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{body}</div>
    </div>
  )
}
