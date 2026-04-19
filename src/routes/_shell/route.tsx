import { createFileRoute, Outlet, useRouterState } from '@tanstack/react-router'

import { AppHeader } from '@/components/app/app-header'
import { AppSidebar } from '@/components/app/app-sidebar'
import { CloudAuthProvider } from '@/components/app/auth/cloud-auth-provider'
import { CloudInitialBackfill } from '@/components/app/cloud-initial-backfill'
import { MainSidebarExpandRail } from '@/components/app/main-sidebar-expand-rail'
import { WorkspaceFileTreeSidebar } from '@/components/app/file-tree'
import { ShellHeaderToolbarProvider } from '@/components/app/shell-header-toolbar'
import { WorkspaceProvider } from '@/components/app/workspace-context'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { useRuntimeHost } from '@/lib/runtime-host'

export const Route = createFileRoute('/_shell')({
  component: ShellLayout,
})

function ShellLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const host = useRuntimeHost()
  const webHomeSurface =
    pathname === '/' && (host === 'browser' || host === 'pending')

  if (webHomeSurface) {
    return <Outlet />
  }

  return (
    <CloudAuthProvider>
      <CloudInitialBackfill />
      <WorkspaceProvider>
        <SidebarProvider defaultOpen>
          <AppSidebar />
          <MainSidebarExpandRail />
          <WorkspaceFileTreeSidebar />
          <SidebarInset className="flex max-h-svh flex-col overflow-hidden">
            <ShellHeaderToolbarProvider>
              <AppHeader />
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <Outlet />
              </div>
            </ShellHeaderToolbarProvider>
          </SidebarInset>
        </SidebarProvider>
      </WorkspaceProvider>
    </CloudAuthProvider>
  )
}
