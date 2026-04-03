import { useState } from 'react'
import {
  LayoutDashboard,
  Loader2,
  MessageSquare,
  PanelLeftIcon,
  Plus,
  Settings,
} from 'lucide-react'
import { Link, useNavigate, useRouterState } from '@tanstack/react-router'

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
import { chatSessionKey } from '@/lib/chat-sessions/keys'
import { useSessionGenerating } from '@/lib/chat-sessions/store'

import type { WorkspaceConversation } from './workspace-context'
import { useWorkspace } from './workspace-context'
import { WorkspaceSwitcher } from './workspace-switcher'

function NewChatSidebarItem({ pathname }: { pathname: string }) {
  const navigate = useNavigate()
  const {
    activeWorkspaceId,
    activeWorkspace,
    createConversation,
    isTauriRuntime,
  } = useWorkspace()
  const sessionKey = chatSessionKey(activeWorkspaceId, null)
  const generating = useSessionGenerating(sessionKey)
  const [pending, setPending] = useState(false)

  const onNewChat = () => {
    if (!activeWorkspace) return
    if (!isTauriRuntime) {
      navigate({ to: '/chat/new' })
      return
    }
    setPending(true)
    void (async () => {
      try {
        const id = await createConversation()
        navigate({
          to: '/chat/$conversationId',
          params: { conversationId: id },
        })
      } catch (e) {
        console.error(e)
        const msg = e instanceof Error ? e.message : String(e)
        window.alert(msg)
      } finally {
        setPending(false)
      }
    })()
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        type="button"
        onClick={onNewChat}
        disabled={!activeWorkspace || pending}
        isActive={pathname === '/chat/new'}
        tooltip="New chat"
      >
        {pending ? (
          <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
        ) : (
          <Plus className="size-4 shrink-0" aria-hidden />
        )}
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate">New chat</span>
          {generating ? (
            <Loader2
              className="text-sidebar-foreground/70 size-3.5 shrink-0 animate-spin"
              aria-label="Generating reply"
            />
          ) : null}
        </span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

function ConversationSidebarItem({
  workspaceId,
  conversation,
  pathname,
}: {
  workspaceId: string
  conversation: WorkspaceConversation
  pathname: string
}) {
  const sessionKey = chatSessionKey(workspaceId, conversation.id)
  const generating = useSessionGenerating(sessionKey)
  const active = pathname === `/chat/${conversation.id}`

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={active}
        tooltip={`${conversation.title} · ${conversation.updatedLabel}`}
      >
        <Link
          to="/chat/$conversationId"
          params={{ conversationId: conversation.id }}
        >
          <MessageSquare className="size-4 shrink-0" aria-hidden />
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <span className="truncate">{conversation.title}</span>
            {generating ? (
              <Loader2
                className="text-sidebar-foreground/70 size-3.5 shrink-0 animate-spin"
                aria-label="Generating reply"
              />
            ) : null}
          </span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

export function AppSidebar() {
  const { activeWorkspaceId, activeWorkspace, conversations } = useWorkspace()
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader className="gap-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild tooltip="Braian home">
              <Link to="/dashboard">
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
                  <Link to="/dashboard">
                    <LayoutDashboard />
                    <span>Dashboard</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={pathname === '/settings'}
                  tooltip="AI settings"
                >
                  <Link to="/settings">
                    <Settings />
                    <span>Settings</span>
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
                <NewChatSidebarItem pathname={pathname} />
                {!activeWorkspace ? (
                  <p className="text-sidebar-foreground/60 px-2 py-3 text-xs leading-relaxed">
                    Choose a workspace above to list chats and use your project
                    folder.
                  </p>
                ) : conversations.length === 0 ? (
                  <p className="text-sidebar-foreground/60 px-2 py-3 text-xs leading-relaxed">
                    No saved threads in {activeWorkspace.name} yet. Start with
                    new chat or switch workspace.
                  </p>
                ) : (
                  conversations.map((c) => (
                    <ConversationSidebarItem
                      key={c.id}
                      workspaceId={activeWorkspaceId}
                      conversation={c}
                      pathname={pathname}
                    />
                  ))
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
