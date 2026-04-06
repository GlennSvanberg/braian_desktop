import { useMemo, useState } from 'react'
import {
  BookOpen,
  ChevronDown,
  Loader2,
  MonitorPlay,
  MoreHorizontal,
  PanelLeftIcon,
  Pin,
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
import { DETACHED_WORKSPACE_SESSION_ID } from '@/lib/chat-sessions/detached'
import { chatSessionKey } from '@/lib/chat-sessions/keys'
import { useSessionGenerating } from '@/lib/chat-sessions/store'
import { cn } from '@/lib/utils'
import type { WorkspaceDto } from '@/lib/workspace-api'
import {
  conversationDelete,
  conversationSetPinned,
  conversationSetTitle,
} from '@/lib/workspace-api'

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
  const {
    activeWorkspaceId,
    setActiveWorkspaceId,
    optimisticSetConversationPinned,
    refreshConversationsForWorkspace,
  } = useWorkspace()
  const router = useRouter()
  const sessionKey = chatSessionKey(workspaceId, conversation.id)
  const generating = useSessionGenerating(sessionKey)
  const active = pathname === `/chat/${conversation.id}`

  const onTogglePin = () => {
    const pinned = !conversation.pinned
    optimisticSetConversationPinned({
      workspaceId,
      conversationId: conversation.id,
      pinned,
    })
    void (async () => {
      try {
        await conversationSetPinned({
          id: conversation.id,
          workspaceId,
          pinned,
        })
        await refreshConversationsForWorkspace(workspaceId)
        if (pathname === `/chat/${conversation.id}`) {
          await router.invalidate()
        }
      } catch (e) {
        optimisticSetConversationPinned({
          workspaceId,
          conversationId: conversation.id,
          pinned: !pinned,
        })
        console.error(e)
        const msg = e instanceof Error ? e.message : String(e)
        window.alert(msg)
      }
    })()
  }

  return (
    <SidebarMenuItem
      className={cn(
        'rounded-md transition-colors',
        'hover:bg-sidebar-accent focus-within:bg-sidebar-accent',
        'has-[[data-slot=sidebar-menu-button][data-active=true]]:bg-sidebar-chat-selected',
        'has-[[data-slot=sidebar-menu-button][data-active=true]]:hover:bg-sidebar-chat-selected-hover',
        'has-[[data-slot=sidebar-menu-button][data-active=true]]:focus-within:bg-sidebar-chat-selected-hover',
      )}
    >
      <SidebarMenuAction
        showOnHover={!conversation.pinned}
        className="left-2 right-auto z-10"
        aria-label={
          conversation.pinned ? 'Unpin from top' : 'Pin to top'
        }
        title={conversation.pinned ? 'Unpin from top' : 'Pin to top'}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onTogglePin()
        }}
      >
        <Pin
          className={cn(
            'size-4',
            conversation.pinned && 'opacity-90',
          )}
          aria-hidden
        />
      </SidebarMenuAction>
      <SidebarMenuButton
        asChild
        isActive={active}
        className={cn(
          'group-has-data-[sidebar=menu-action]/menu-item:!pr-2',
          // Row fill is painted on SidebarMenuItem (hover / active / focus-within) so it covers actions.
          '!bg-transparent',
          // Override CVA [&>span:last-child]:truncate (ellipsis); clip overflow only (no …).
          '[&>span:last-child]:!min-w-0 [&>span:last-child]:!overflow-hidden [&>span:last-child]:!whitespace-nowrap [&>span:last-child]:!text-clip',
        )}
        tooltip={`${conversation.title} · ${conversation.updatedLabel}`}
      >
        <Link
          to="/chat/$conversationId"
          params={{ conversationId: conversation.id }}
          className="flex min-w-0 w-full max-w-full items-center gap-2"
          onClick={() => {
            if (workspaceId !== activeWorkspaceId) {
              setActiveWorkspaceId(workspaceId)
            }
          }}
        >
          <span className="size-4 shrink-0" aria-hidden />
          <span className="flex min-w-0 min-h-0 flex-1 items-center gap-2 overflow-hidden">
            <span className="min-w-0 flex-1 whitespace-nowrap">
              {conversation.title}
            </span>
            {generating ? (
              <Loader2
                className="text-sidebar-foreground/70 size-3.5 shrink-0 animate-spin"
                aria-label="Generating reply"
              />
            ) : conversation.unread ? (
              <span
                className="bg-success size-2 shrink-0 rounded-full"
                aria-label="Unread messages"
              />
            ) : null}
          </span>
        </Link>
      </SidebarMenuButton>
      {/*
        On hover/focus, same surface as the row hover (sidebar-accent) sits above the label so actions
        read cleanly; default state uses full row width for text (no reserved action gutter).
      */}
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-y-0 right-0 z-[15] w-[5.5rem]',
          // Feather into the label (no hard vertical edge); solid under the icons on the right.
          'bg-gradient-to-r from-transparent via-sidebar-accent to-sidebar-accent',
          'group-has-[[data-slot=sidebar-menu-button][data-active=true]]/menu-item:via-sidebar-chat-selected group-has-[[data-slot=sidebar-menu-button][data-active=true]]/menu-item:to-sidebar-chat-selected',
          'group-has-[[data-slot=sidebar-menu-button][data-active=true]]/menu-item:group-hover/menu-item:via-sidebar-chat-selected-hover group-has-[[data-slot=sidebar-menu-button][data-active=true]]/menu-item:group-hover/menu-item:to-sidebar-chat-selected-hover',
          'group-has-[[data-slot=sidebar-menu-button][data-active=true]]/menu-item:group-has-[[data-slot=sidebar-menu-action]:focus]/menu-item:via-sidebar-chat-selected-hover group-has-[[data-slot=sidebar-menu-button][data-active=true]]/menu-item:group-has-[[data-slot=sidebar-menu-action]:focus]/menu-item:to-sidebar-chat-selected-hover',
          'transition-opacity duration-150',
          'max-md:opacity-100',
          'md:opacity-0 md:group-hover/menu-item:opacity-100 md:group-has-[[data-slot=sidebar-menu-action]:focus]/menu-item:opacity-100',
        )}
      />
      <SidebarMenuAction
        showOnHover
        disabled={deletePending}
        className="text-sidebar-foreground/80 hover:text-destructive right-9 z-20"
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
            className="right-3 z-20"
            aria-label={`Actions for ${conversation.title}`}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
          >
            <MoreHorizontal className="size-4" aria-hidden />
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onSelect={() => onRename(conversation)}>
            Rename…
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onTogglePin}>
            {conversation.pinned ? 'Unpin from top' : 'Pin to top'}
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
  const sortedConversations = useMemo(() => {
    return [...conversations].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return b.updatedAtMs - a.updatedAtMs
    })
  }, [conversations])
  const shown = chatsExpanded
    ? sortedConversations
    : sortedConversations.slice(0, VISIBLE_CHATS_DEFAULT)
  const hasMoreChats = sortedConversations.length > VISIBLE_CHATS_DEFAULT

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
    <Collapsible
      asChild
      defaultOpen={workspace.id === activeWorkspaceId}
      className="group/collapsible"
    >
      <li className="group/workspace-row relative min-w-0 list-none">
        <CollapsibleTrigger asChild>
          <SidebarMenuAction
            className="text-sidebar-foreground/75 left-1.5 right-auto z-20 size-7 bg-transparent hover:bg-sidebar-accent/35 data-[state=open]:bg-sidebar-accent/35"
            aria-label="Show or hide workspace pages and chats"
          >
            <ChevronDown
              className="size-3.5 shrink-0 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-0 group-data-[state=closed]/collapsible:-rotate-90"
              aria-hidden
            />
          </SidebarMenuAction>
        </CollapsibleTrigger>

        <SidebarMenuButton
          type="button"
          isActive={
            workspace.id === activeWorkspaceId &&
            (pathname === `/workspace/${workspace.id}/webapp` ||
              pathname === `/workspace/${workspace.id}/webapp/settings` ||
              pathname.startsWith('/dashboard'))
          }
          tooltip={workspace.name}
          className={cn(
            'text-sidebar-foreground/75 h-8 min-w-0 gap-1.5 pl-8 text-xs font-medium',
            'group-has-data-[sidebar=menu-action]/menu-item:!pr-2',
          )}
          onClick={() => {
            setActiveWorkspaceId(workspace.id)
            navigate({
              to: '/workspace/$workspaceId/webapp',
              params: { workspaceId: workspace.id },
            })
          }}
        >
          <span className="min-w-0 flex-1 overflow-hidden text-clip whitespace-nowrap">
            {workspace.name}
          </span>
          <span
            className="pointer-events-none shrink-0 self-stretch w-[3.5rem]"
            aria-hidden
          />
        </SidebarMenuButton>

        <SidebarMenuAction
          className="text-sidebar-foreground/80 right-9 z-30 size-7 [&>svg]:size-4"
          aria-label={`Workspace settings for ${workspace.name}`}
          title="Workspace settings (Connections)"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setActiveWorkspaceId(workspace.id)
            navigate({
              to: '/workspace/$workspaceId/settings',
              params: { workspaceId: workspace.id },
            })
          }}
        >
          <Settings
            className={cn(
              pathname === `/workspace/${workspace.id}/settings` &&
                'text-sidebar-accent-foreground',
            )}
            aria-hidden
          />
        </SidebarMenuAction>

        <SidebarMenuAction
          className="text-sidebar-foreground/80 right-3 z-30 size-7 [&>svg]:size-4"
          disabled={newPending}
          aria-label={`New chat in ${workspace.name}`}
          title={`New chat in ${workspace.name}`}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onNewInWorkspace(e)
          }}
        >
          {newPending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Plus className="size-4" aria-hidden />
          )}
        </SidebarMenuAction>

        <CollapsibleContent asChild>
          <SidebarMenu className="border-sidebar-border mx-1 ml-1 mt-0.5 border-l pl-1.5">
            <SidebarMenuItem
              className={cn(
                'rounded-md transition-colors',
                'hover:bg-sidebar-accent focus-within:bg-sidebar-accent',
                'has-[[data-slot=sidebar-menu-button][data-active=true]]:bg-sidebar-chat-selected',
                'has-[[data-slot=sidebar-menu-button][data-active=true]]:hover:bg-sidebar-chat-selected-hover',
                'has-[[data-slot=sidebar-menu-button][data-active=true]]:focus-within:bg-sidebar-chat-selected-hover',
              )}
            >
              <SidebarMenuButton
                asChild
                tooltip="Published webapp (main view)"
                className="group-has-data-[sidebar=menu-action]/menu-item:!pr-2 !bg-transparent"
                isActive={
                  pathname === `/workspace/${workspace.id}/webapp` &&
                  workspace.id === activeWorkspaceId
                }
              >
                <Link
                  to="/workspace/$workspaceId/webapp"
                  params={{ workspaceId: workspace.id }}
                  className="truncate"
                  onClick={() => {
                    if (workspace.id !== activeWorkspaceId) {
                      setActiveWorkspaceId(workspace.id)
                    }
                  }}
                >
                  <MonitorPlay className="size-4 shrink-0 opacity-70" aria-hidden />
                  <span className="truncate">Webapp</span>
                </Link>
              </SidebarMenuButton>
              <SidebarMenuAction
                className="text-sidebar-foreground/80 z-30 size-7 [&>svg]:size-4"
                aria-label={`Webapp settings for ${workspace.name}`}
                title="Webapp settings (template, deps, dev preview)"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setActiveWorkspaceId(workspace.id)
                  navigate({
                    to: '/workspace/$workspaceId/webapp/settings',
                    params: { workspaceId: workspace.id },
                  })
                }}
              >
                <Settings
                  className={cn(
                    pathname ===
                      `/workspace/${workspace.id}/webapp/settings` &&
                      'text-sidebar-accent-foreground',
                  )}
                  aria-hidden
                />
              </SidebarMenuAction>
            </SidebarMenuItem>
            {sortedConversations.length === 0 ? (
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
      </li>
    </Collapsible>
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

  const workspacesMenu = (
    <SidebarMenu>
      <NewAgentSidebarItem pathname={pathname} />
      {workspaces.length === 0 ? (
        <p className="text-sidebar-foreground/60 px-2 py-3 text-xs leading-relaxed">
          Use <span className="font-medium">Manage workspaces</span> below to add
          a folder and list chats here.
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
              createConversationInWorkspace={createConversationInWorkspace}
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
  )

  return (
    <Sidebar collapsible="offcanvas" variant="inset">
      <SidebarHeader
        className={cn('gap-3', isTauriRuntime ? 'pt-4' : '')}
        data-tauri-drag-region={isTauriRuntime ? true : undefined}
      >
        <SidebarMenu data-tauri-drag-region={isTauriRuntime ? false : undefined}>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              asChild
              tooltip="Braian home"
              className="group-data-[collapsible=icon]:!size-11 group-data-[collapsible=icon]:!min-h-11 group-data-[collapsible=icon]:!min-w-11 group-data-[collapsible=icon]:!p-1.5"
            >
              <Link to="/dashboard">
                <img
                  src="/braian-logo.png"
                  alt=""
                  width={48}
                  height={48}
                  draggable={false}
                  className="size-12 shrink-0 object-contain group-data-[collapsible=icon]:size-11"
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate text-left text-sm font-semibold leading-tight">
                  Braian
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
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
                  isActive={
                    pathname.startsWith('/dashboard') ||
                    (!!activeWorkspaceId &&
                      (pathname === `/workspace/${activeWorkspaceId}/webapp` ||
                        pathname ===
                          `/workspace/${activeWorkspaceId}/webapp/settings`))
                  }
                  tooltip="Workspace webapp (published view or settings)"
                >
                  <Link to="/dashboard">
                    <MonitorPlay />
                    <span>Webapp</span>
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
          <SidebarGroupLabel>Workspaces</SidebarGroupLabel>
          <SidebarGroupContent className="min-h-0">
            {/*
              Radix ScrollArea forces overflow-x: hidden on the viewport, which clips
              right-aligned SidebarMenuAction controls in Tauri/WebView2. Native overflow-y
              avoids that while keeping vertical scroll.
            */}
            {isTauriRuntime ? (
              <div className="h-[min(320px,calc(100vh-320px))] overflow-y-auto overscroll-contain pr-2 md:h-[min(420px,calc(100svh-280px))]">
                {workspacesMenu}
              </div>
            ) : (
              <ScrollArea className="h-[min(320px,calc(100vh-320px))] pr-4 md:h-[min(420px,calc(100svh-280px))]">
                {workspacesMenu}
              </ScrollArea>
            )}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="gap-2">
        <WorkspaceSwitcher />
        <SidebarSeparator className="mx-0" />
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
