import { createFileRoute, Outlet } from '@tanstack/react-router'

import { AppHeader } from '@/components/app/app-header'
import { AppSidebar } from '@/components/app/app-sidebar'
import { WorkspaceProvider } from '@/components/app/workspace-context'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'

export const Route = createFileRoute('/_shell')({
  component: ShellLayout,
})

function ShellLayout() {
  return (
    <WorkspaceProvider>
      <SidebarProvider defaultOpen>
        <AppSidebar />
        <SidebarInset className="flex max-h-svh flex-col overflow-hidden">
          <AppHeader />
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <Outlet />
          </div>
        </SidebarInset>
      </SidebarProvider>
    </WorkspaceProvider>
  )
}
