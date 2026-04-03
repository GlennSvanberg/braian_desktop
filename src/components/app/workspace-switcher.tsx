import { ChevronsUpDown, GalleryVerticalEnd, Plus } from 'lucide-react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { MOCK_WORKSPACES } from '@/lib/mock-workspace-data'

import { useWorkspace } from './workspace-context'

export function WorkspaceSwitcher() {
  const { isMobile } = useSidebar()
  const { activeWorkspace, setActiveWorkspaceId } = useWorkspace()

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <GalleryVerticalEnd className="size-4 shrink-0" />
              </div>
              <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">
                  {activeWorkspace.name}
                </span>
                <span className="truncate text-xs text-sidebar-foreground/65">
                  Workspace
                </span>
              </div>
              <ChevronsUpDown className="ml-auto shrink-0 opacity-50" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-56 rounded-lg"
            align="start"
            side={isMobile ? 'bottom' : 'right'}
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-text-3 text-xs font-normal">
              Switch workspace
            </DropdownMenuLabel>
            {MOCK_WORKSPACES.map((ws) => (
              <DropdownMenuItem
                key={ws.id}
                onClick={() => setActiveWorkspaceId(ws.id)}
                className="cursor-pointer gap-2 p-2"
              >
                <div className="flex size-6 items-center justify-center rounded-md border border-border bg-muted">
                  <GalleryVerticalEnd className="size-3.5 shrink-0 opacity-70" />
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium">{ws.name}</span>
                  <span className="text-text-3 text-xs">{ws.description}</span>
                </div>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="cursor-pointer gap-2 p-2 text-text-3">
              <Plus className="size-4" />
              <span>New workspace (soon)</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
