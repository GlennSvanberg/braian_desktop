import { useEffect, useState } from 'react'
import {
  BookOpen,
  ChevronDown,
  FileText,
  LayoutDashboard,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  PanelLeftIcon,
  Plus,
  Settings,
  Trash2,
  UserRound,
} from 'lucide-react'
import {
  Link,
  useNavigate,
  useRouter,
  useRouterState,
} from '@tanstack/react-router'

import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
} from '@/components/ui/sidebar'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { listWorkspaceDashboardPageIds } from '@/lib/workspace-dashboard'
import { DETACHED_WORKSPACE_SESSION_ID } from '@/lib/chat-sessions/detached'
import { chatSessionKey } from '@/lib/chat-sessions/keys'
import { useSessionGenerating } from '@/lib/chat-sessions/store'
import type { WorkspaceDto } from '@/lib/workspace-api'
import { conversationDelete, conversationSetTitle } from '@/lib/workspace-api'

import type { WorkspaceConversation } from './workspace-context'
import { useWorkspace } from './workspace-context'
import { WorkspaceSwitcher } from './workspace-switcher'

const VISIBLE_WORKSPACES_DEFAULT = 8
const VISIBLE_CHATS_DEFAULT = 6

function NewAgentSidebarItem({ pathname }: { pathname: string }) {
  const navigate = useNavigate()
  const sessionKey = chatSessionKey(DETACHED_WORKSPACE_SESSION_ID, null)
  const generating = useSessionGenerating(sessionKey)

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        type="button"
        onClick={() => navigate({ to: '/chat/new' })}
        isActive={pathname === '/chat/new'}
        tooltip="New agent (move to a workspace when you want a saved project thread)"
      >
        <Plus className="size-4 shrink-0" aria-hidden />
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate">New agent</span>
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
  onRename,
  onDelete,
  deletePending,
}: {
  workspaceId: string
  conversation: WorkspaceConversation
  pathname: string
  onRename: (c: WorkspaceConversation) => void
  onDelete: (c: WorkspaceConversation) => void
  deletePending: boolean
}) {
  const { activeWorkspaceId, setActiveWorkspaceId } = useWorkspace()
  const sessionKey = chatSessionKey(workspaceId, conversation.id)
  const generating = useSessionGenerating(sessionKey)
  const active = pathname === `/chat/${conversation.id}`

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={active}
        className="pr-14"
        tooltip={`${conversation.title} · ${conversation.updatedLabel}`}
      >
        <Link
          to="/chat/$conversationId"
          params={{ conversationId: conversation.id }}
          onClick={() => {
            if (workspaceId !== activeWorkspaceId) {
              setActiveWorkspaceId(workspaceId)
            }
          }}
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
      <SidebarMenuAction
        showOnHover
        disabled={deletePending}
        className="text-sidebar-foreground/80 hover:text-destructive right-7"
        aria-label={`Delete ${conversation.title}`}
        title="Delete chat"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onDelete(conversation)
        }}
      >
        {deletePending ? (
          <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
        ) : (
          <Trash2 className="size-4" aria-hidden />
        )}
      </SidebarMenuAction>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction
            showOnHover
            className="right-1"
            aria-label={`Actions for ${conversation.title}`}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
          >
            <MoreHorizontal className="size-4" aria-hidden />
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem onSelect={() => onRename(conversation)}>
            Rename…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  )
}

function WorkspaceConversationGroup({
  workspace,
  conversations,
  pathname,
  activeWorkspaceId,
  expandedChats,
  onExpandChats,
  onRename,
  onDelete,
  deleteTargetId,
  isTauriRuntime,
  navigate,
  createConversationInWorkspace,
  setActiveWorkspaceId,
}: {
  workspace: WorkspaceDto
  conversations: WorkspaceConversation[]
  pathname: string
  activeWorkspaceId: string
  expandedChats: boolean
  onExpandChats: () => void
  onRename: (c: WorkspaceConversation) => void
  onDelete: (c: WorkspaceConversation) => void
  deleteTargetId: string | null
  isTauriRuntime: boolean
  navigate: ReturnType<typeof useNavigate>
  createConversationInWorkspace: (id: string) => Promise<string>
  setActiveWorkspaceId: (id: string) => void
}) {
  const [newPending, setNewPending] = useState(false)
  const chatsExpanded = expandedChats
  const shown = chatsExpanded
    ? conversations
    : conversations.slice(0, VISIBLE_CHATS_DEFAULT)
  const hasMoreChats = conversations.length > VISIBLE_CHATS_DEFAULT

  const onNewInWorkspace = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!isTauriRuntime) {
      setActiveWorkspaceId(workspace.id)
      navigate({ to: '/chat/new' })
      return
    }
    setNewPending(true)
    void (async () => {
      try {
        const id = await createConversationInWorkspace(workspace.id)
        setActiveWorkspaceId(workspace.id)
        navigate({
          to: '/chat/$conversationId',
          params: { conversationId: id },
        })
      } catch (err) {
        console.error(err)
        const msg = err instanceof Error ? err.message : String(err)
        window.alert(msg)
      } finally {
        setNewPending(false)
      }
    })()
  }

  return (
    <SidebarMenuItem className="group/workspace-row list-none p-0">
      <Collapsible
        defaultOpen={workspace.id === activeWorkspaceId}
        className="group/collapsible w-full min-w-0"
      >
        <div className="flex w-full min-w-0 items-center gap-0.5 pe-0.5">
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="text-sidebar-foreground/75 size-7 shrink-0 data-[state=open]:bg-sidebar-accent/35"
              aria-label={
                chatsExpanded ? 'Collapse chats' : 'Expand chats'
              }
            >
              <ChevronDown
                className="size-3.5 shrink-0 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-0 group-data-[state=closed]/collapsible:-rotate-90"
                aria-hidden
              />
            </Button>
          </CollapsibleTrigger>
          <SidebarMenuButton
            type="button"
            isActive={
              workspace.id === activeWorkspaceId &&
              pathname.startsWith('/dashboard')
            }
            tooltip={workspace.name}
            className="text-sidebar-foreground/75 h-8 min-w-0 w-auto max-w-full flex-1 gap-1.5 pr-1 text-xs font-medium"
            onClick={() => {
              setActiveWorkspaceId(workspace.id)
              navigate({ to: '/dashboard' })
            }}
          >
            <span className="truncate">{workspace.name}</span>
          </SidebarMenuButton>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-sidebar-foreground/70 size-7 shrink-0"
                disabled={newPending}
                aria-label={`New chat in ${workspace.name}`}
                onClick={onNewInWorkspace}
              >
                {newPending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Plus className="size-4" aria-hidden />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              New chat in {workspace.name}
            </TooltipContent>
          </Tooltip>
        </div>
        <CollapsibleContent>
          <SidebarMenu className="border-sidebar-border mx-1 ml-2.5 mt-0.5 border-l pl-2">
            {conversations.length === 0 ? (
              <p className="text-sidebar-foreground/55 px-2 py-1.5 text-[11px] leading-snug">
                No saved threads yet.
              </p>
            ) : (
              <>
                {shown.map((c) => (
                  <ConversationSidebarItem
                    key={c.id}
                    workspaceId={workspace.id}
                    conversation={c}
                    pathname={pathname}
                    onRename={onRename}
                    onDelete={onDelete}
                    deletePending={deleteTargetId === c.id}
                  />
                ))}
                {hasMoreChats && !chatsExpanded ? (
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      type="button"
                      className="text-sidebar-foreground/65 h-8 text-xs"
                      onClick={onExpandChats}
                    >
                      <MoreHorizontal className="size-4 shrink-0" aria-hidden />
                      <span>More</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ) : null}
              </>
            )}
          </SidebarMenu>
        </CollapsibleContent>
      </Collapsible>
    </SidebarMenuItem>
  )
}

export function AppSidebar() {
  const router = useRouter()
  const navigate = useNavigate()
  const {
    workspaces,
    activeWorkspaceId,
    conversationsByWorkspace,
    refreshConversations,
    createConversationInWorkspace,
    setActiveWorkspaceId,
    isTauriRuntime,
  } = useWorkspace()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const docsActive = pathname.startsWith('/docs')
  const userPageActive = pathname.startsWith('/user')
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameDraft, setRenameDraft] = useState('')
  const [renameTargetId, setRenameTargetId] = useState<string | null>(null)
  const [renameTargetWorkspaceId, setRenameTargetWorkspaceId] = useState<
    string | null
  >(null)
  const [renameBusy, setRenameBusy] = useState(false)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [showAllWorkspaces, setShowAllWorkspaces] = useState(false)
  const [expandedChatsByWs, setExpandedChatsByWs] = useState<
    Record<string, boolean>
  >({})
  const [dashboardPageIds, setDashboardPageIds] = useState<string[]>([])

  useEffect(() => {
    if (!isTauriRuntime || !activeWorkspaceId) {
      setDashboardPageIds([])
      return
    }
    let cancelled = false
    void listWorkspaceDashboardPageIds(activeWorkspaceId).then((ids) => {
      if (!cancelled) setDashboardPageIds(ids)
    })
    return () => {
      cancelled = true
    }
  }, [activeWorkspaceId, isTauriRuntime, pathname])

  const visibleWorkspaces = showAllWorkspaces
    ? workspaces
    : workspaces.slice(0, VISIBLE_WORKSPACES_DEFAULT)
  const hasMoreWorkspaces = workspaces.length > VISIBLE_WORKSPACES_DEFAULT

  const openRename = (c: WorkspaceConversation) => {
    setRenameTargetId(c.id)
    setRenameTargetWorkspaceId(c.workspaceId)
    setRenameDraft(c.title)
    setRenameOpen(true)
  }

  const submitRename = () => {
    if (!renameTargetWorkspaceId || !renameTargetId) return
    const trimmed = renameDraft.trim()
    if (!trimmed) return
    setRenameBusy(true)
    void (async () => {
      try {
        await conversationSetTitle({
          id: renameTargetId,
          workspaceId: renameTargetWorkspaceId,
          title: trimmed,
        })
        await refreshConversations()
        if (pathname === `/chat/${renameTargetId}`) {
          await router.invalidate()
        }
        setRenameOpen(false)
      } catch (e) {
        console.error(e)
        const msg = e instanceof Error ? e.message : String(e)
        window.alert(msg)
      } finally {
        setRenameBusy(false)
      }
    })()
  }

  const confirmDelete = (c: WorkspaceConversation) => {
    const ok = window.confirm(
      `Delete “${c.title}”? This cannot be undone.`,
    )
    if (!ok) return
    setDeleteTargetId(c.id)
    void (async () => {
      try {
        await conversationDelete({
          id: c.id,
          workspaceId: c.workspaceId,
        })
        await refreshConversations()
        if (pathname === `/chat/${c.id}`) {
          navigate({ to: '/chat/new' })
          await router.invalidate()
        }
      } catch (e) {
        console.error(e)
        const msg = e instanceof Error ? e.message : String(e)
        window.alert(msg)
      } finally {
        setDeleteTargetId(null)
      }
    })()
  }

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
        {dashboardPageIds.length > 0 ? (
          <SidebarGroup>
            <SidebarGroupLabel>App pages</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {dashboardPageIds.map((pageId) => (
                  <SidebarMenuItem key={pageId}>
                    <SidebarMenuButton
                      asChild
                      tooltip={pageId}
                      isActive={pathname === `/dashboard/page/${pageId}`}
                    >
                      <Link
                        to="/dashboard/page/$pageId"
                        params={{ pageId }}
                        className="truncate"
                      >
                        <FileText className="size-4 shrink-0 opacity-70" aria-hidden />
                        <span className="truncate">{pageId}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}
        <SidebarGroup className="min-h-0 flex-1">
          <SidebarGroupLabel>Workspaces</SidebarGroupLabel>
          <SidebarGroupContent className="min-h-0">
            <ScrollArea className="h-[min(320px,calc(100vh-320px))] pr-2 md:h-[min(420px,calc(100svh-280px))]">
              <SidebarMenu>
                <NewAgentSidebarItem pathname={pathname} />
                {workspaces.length === 0 ? (
                  <p className="text-sidebar-foreground/60 px-2 py-3 text-xs leading-relaxed">
                    Add a workspace above to list chats and use your project
                    folder.
                  </p>
                ) : (
                  <>
                    {visibleWorkspaces.map((ws) => (
                      <WorkspaceConversationGroup
                        key={ws.id}
                        workspace={ws}
                        conversations={conversationsByWorkspace[ws.id] ?? []}
                        pathname={pathname}
                        activeWorkspaceId={activeWorkspaceId}
                        expandedChats={expandedChatsByWs[ws.id] ?? false}
                        onExpandChats={() =>
                          setExpandedChatsByWs((prev) => ({
                            ...prev,
                            [ws.id]: true,
                          }))
                        }
                        onRename={openRename}
                        onDelete={confirmDelete}
                        deleteTargetId={deleteTargetId}
                        isTauriRuntime={isTauriRuntime}
                        navigate={navigate}
                        createConversationInWorkspace={
                          createConversationInWorkspace
                        }
                        setActiveWorkspaceId={setActiveWorkspaceId}
                      />
                    ))}
                    {hasMoreWorkspaces && !showAllWorkspaces ? (
                      <SidebarMenuItem>
                        <SidebarMenuButton
                          type="button"
                          className="text-sidebar-foreground/65 h-8 text-xs"
                          onClick={() => setShowAllWorkspaces(true)}
                        >
                          <MoreHorizontal className="size-4 shrink-0" aria-hidden />
                          <span>More workspaces</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ) : null}
                  </>
                )}
              </SidebarMenu>
            </ScrollArea>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="gap-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={userPageActive}
              tooltip="Your profile"
            >
              <Link to="/user">
                <UserRound />
                <span>You</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={docsActive}
              tooltip="Documentation"
            >
              <Link to="/docs">
                <BookOpen />
                <span>Documentation</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
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
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent showCloseButton={!renameBusy}>
          <DialogHeader>
            <DialogTitle>Rename chat</DialogTitle>
          </DialogHeader>
          <Input
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                submitRename()
              }
            }}
            placeholder="Chat title"
            autoFocus
            disabled={renameBusy}
            aria-label="Chat title"
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={renameBusy}
              onClick={() => setRenameOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="gap-2"
              disabled={renameBusy || !renameDraft.trim()}
              onClick={submitRename}
            >
              {renameBusy ? (
                <>
                  <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
                  Saving…
                </>
              ) : (
                'Save'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Sidebar>
  )
}
