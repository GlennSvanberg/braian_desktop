import { createFileRoute, Outlet } from '@tanstack/react-router'

import { AppHeader } from '@/components/app/app-header'
import { AppSidebar } from '@/components/app/app-sidebar'
import { WorkspaceProvider } from '@/components/app/workspace-context'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { isTauri } from '@/lib/tauri-env'

export const Route = createFileRoute('/_shell')({
  component: ShellLayout,
})

function ShellLayout() {
  const tauriChrome = isTauri()

  return (
    <WorkspaceProvider>
      <div className="flex h-svh max-h-svh w-full flex-col overflow-hidden">
        {tauriChrome ? (
          <div
            aria-hidden
            className="border-border flex h-3 shrink-0 border-b bg-background/85 backdrop-blur-md supports-backdrop-filter:bg-background/70"
            data-tauri-drag-region
          />
        ) : null}
        <SidebarProvider
          defaultOpen
          className="min-h-0 flex-1 overflow-hidden"
        >
          <AppSidebar />
          <SidebarInset className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <AppHeader />
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <Outlet />
            </div>
          </SidebarInset>
        </SidebarProvider>
      </div>
    </WorkspaceProvider>
  )
}
