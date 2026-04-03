import { LayoutDashboard, MessageSquare, PanelLeftIcon, Plus } from 'lucide-react'
import { Link, useRouterState } from '@tanstack/react-router'

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
} from '@/components/ui/sidebar'
import { ScrollArea } from '@/components/ui/scroll-area'
import { getConversationsForWorkspace } from '@/lib/mock-workspace-data'

import { useWorkspace } from './workspace-context'
import { WorkspaceSwitcher } from './workspace-switcher'

export function AppSidebar() {
  const { activeWorkspaceId, activeWorkspace } = useWorkspace()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const conversations = getConversationsForWorkspace(activeWorkspaceId)

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader className="gap-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild tooltip="Braian home">
              <Link to="/dashboard" preload="intent">
                <div className="bg-primary text-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg text-sm font-bold shadow-sm">
                  B
                </div>
                <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">Braian</span>
                  <span className="text-sidebar-foreground/65 truncate text-xs">
                    Local workspace
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <WorkspaceSwitcher />
      </SidebarHeader>
      <SidebarSeparator />
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={pathname.startsWith('/dashboard')}
                  tooltip="Dashboard"
                >
                  <Link to="/dashboard" preload="intent">
                    <LayoutDashboard />
                    <span>Dashboard</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup className="min-h-0 flex-1">
          <SidebarGroupLabel>Conversations</SidebarGroupLabel>
          <SidebarGroupContent className="min-h-0">
            <ScrollArea className="h-[min(320px,calc(100vh-320px))] pr-2 md:h-[min(420px,calc(100svh-280px))]">
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname === '/chat/new'}
                    tooltip="New chat"
                  >
                    <Link to="/chat/new" preload="intent">
                      <Plus className="size-4" />
                      <span>New chat</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                {conversations.length === 0 ? (
                  <p className="text-sidebar-foreground/60 px-2 py-3 text-xs leading-relaxed">
                    No saved threads in {activeWorkspace.name} yet. Start with
                    new chat or switch workspace.
                  </p>
                ) : (
                  conversations.map((c) => {
                    const active = pathname === `/chat/${c.id}`
                    return (
                      <SidebarMenuItem key={c.id}>
                        <SidebarMenuButton
                          asChild
                          isActive={active}
                          tooltip={`${c.title} · ${c.updatedLabel}`}
                        >
                          <Link
                            to="/chat/$conversationId"
                            params={{ conversationId: c.id }}
                            preload="intent"
                          >
                            <MessageSquare />
                            <span className="truncate">{c.title}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    )
                  })
                )}
              </SidebarMenu>
            </ScrollArea>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="gap-2">
        <div className="text-sidebar-foreground/55 flex items-center gap-2 overflow-hidden px-1 text-xs">
          <PanelLeftIcon className="size-3.5 shrink-0 opacity-70" />
          <span className="truncate">
            <kbd className="bg-sidebar-accent text-sidebar-foreground/80 pointer-events-none hidden rounded border border-sidebar-border px-1.5 py-0.5 font-mono text-[10px] font-medium sm:inline">
              Ctrl+B
            </kbd>
            <span className="sm:ml-1">toggle sidebar</span>
          </span>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
