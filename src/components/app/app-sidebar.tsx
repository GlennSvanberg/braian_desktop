import { useMemo, useState } from 'react'
import {
  BookOpen,
  ChevronDown,
  Loader2,
  MoreHorizontal,
  PanelLeftIcon,
  PanelLeftClose,
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
  DialogDescription,
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
  useSidebar,
} from '@/components/ui/sidebar'
import { ScrollArea } from '@/components/ui/scroll-area'
import { PERSONAL_WORKSPACE_SESSION_ID } from '@/lib/chat-sessions/detached'
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
import { parseDashboardTabFromSearchStr } from './workspace-dashboard'

const VISIBLE_WORKSPACES_DEFAULT = 8
const VISIBLE_CHATS_DEFAULT = 6

function NewSimpleChatSidebarItem({ pathname }: { pathname: string }) {
  const navigate = useNavigate()
  const {
    createConversationInWorkspace,
    setActiveWorkspaceId,
    isTauriRuntime,
  } = useWorkspace()
  const [pending, setPending] = useState(false)

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        type="button"
        disabled={pending}
        onClick={() => {
          if (!isTauriRuntime) {
            navigate({ to: '/chat/new' })
            return
          }
          setPending(true)
          void (async () => {
            try {
              const id = await createConversationInWorkspace(
                PERSONAL_WORKSPACE_SESSION_ID,
              )
              setActiveWorkspaceId(PERSONAL_WORKSPACE_SESSION_ID)
              navigate({
                to: '/chat/$conversationId',
                params: { conversationId: id },
              })
            } catch (err) {
              console.error(err)
              const msg = err instanceof Error ? err.message : String(err)
              window.alert(msg)
            } finally {
              setPending(false)
            }
          })()
        }}
        isActive={pathname === '/chat/new'}
        tooltip="Start a new simple chat (saved under Simple chats until you move it to a project)"
      >
        {pending ? (
          <Loader2
            className="text-sidebar-foreground/70 size-4 shrink-0 animate-spin"
            aria-hidden
          />
        ) : (
          <Plus className="size-4 shrink-0" aria-hidden />
        )}
        <span className="truncate">New simple chat</span>
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
        'relative before:absolute before:inset-y-1 before:left-0 before:w-1 before:rounded-full before:bg-sidebar-primary before:opacity-0 has-[[data-slot=sidebar-menu-button][data-active=true]]:before:opacity-100 before:transition-opacity',
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
  routerSearchStr,
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
  hideFolderSettings = false,
}: {
  workspace: WorkspaceDto
  conversations: WorkspaceConversation[]
  pathname: string
  /** Current `location.searchStr` (used with `/dashboard` for tab-aware UI). */
  routerSearchStr: string
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
  /** Built-in Simple chats: no per-folder MCP/settings entry. */
  hideFolderSettings?: boolean
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

  const dashboardTab = pathname.startsWith('/dashboard')
    ? parseDashboardTabFromSearchStr(routerSearchStr)
    : null
  const workspaceSettingsGearActive =
    pathname === `/workspace/${workspace.id}/settings` ||
    (pathname.startsWith('/dashboard') &&
      dashboardTab === 'workspace-settings' &&
      workspace.id === activeWorkspaceId)

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
      <li className={cn(
        'group/workspace-row relative min-w-0 list-none',
        'before:absolute before:inset-y-1 before:left-0 before:w-1 before:rounded-full before:bg-sidebar-primary before:opacity-0 before:transition-opacity',
        workspace.id === activeWorkspaceId &&
          (pathname === `/workspace/${workspace.id}/webapp` ||
            pathname === `/workspace/${workspace.id}/webapp/settings` ||
            pathname.startsWith('/dashboard') ||
            pathname.startsWith('/chat/')) &&
          'before:opacity-100',
      )}>
        <CollapsibleTrigger asChild>
          <SidebarMenuAction
            className={cn(
              'text-sidebar-foreground/75 left-1.5 right-auto z-20 size-7 bg-transparent hover:bg-sidebar-accent/35 data-[state=open]:bg-sidebar-accent/35',
              'group-has-[[data-slot=sidebar-menu-button][data-active=true]]/workspace-row:text-sidebar-accent-foreground',
              'group-has-[[data-slot=sidebar-menu-button][data-active=true]]/workspace-row:hover:text-sidebar-accent-foreground',
            )}
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
              pathname.startsWith('/dashboard') ||
              pathname.startsWith('/chat/'))
          }
          tooltip={workspace.name}
          className={cn(
            'text-sidebar-foreground/75 h-8 min-w-0 gap-1.5 pl-8 text-xs font-medium',
            'group-has-data-[sidebar=menu-action]/menu-item:!pr-2',
          )}
          onClick={() => {
            setActiveWorkspaceId(workspace.id)
            navigate({
              to: '/dashboard',
              search: { tab: 'overview' },
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

        {hideFolderSettings ? null : (
          <SidebarMenuAction
            className="text-sidebar-foreground/80 right-9 z-30 size-7 [&>svg]:size-4"
            aria-label={`Workspace settings for ${workspace.name}`}
            title="Workspace settings (Connections)"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setActiveWorkspaceId(workspace.id)
              navigate({
                to: '/dashboard',
                search: { tab: 'workspace-settings' },
              })
            }}
          >
            <Settings
              className={cn(
                workspaceSettingsGearActive && 'text-sidebar-accent-foreground',
              )}
              aria-hidden
            />
          </SidebarMenuAction>
        )}

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
    projectWorkspaces,
    personalWorkspace,
    activeWorkspaceId,
    conversationsByWorkspace,
    refreshConversations,
    createConversationInWorkspace,
    setActiveWorkspaceId,
    isTauriRuntime,
  } = useWorkspace()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const routerSearchStr = useRouterState({
    select: (s) => s.location.searchStr,
  })
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
  const [deletePrompt, setDeletePrompt] = useState<WorkspaceConversation | null>(
    null,
  )
  const [showAllWorkspaces, setShowAllWorkspaces] = useState(false)
  const [expandedChatsByWs, setExpandedChatsByWs] = useState<
    Record<string, boolean>
  >({})

  const { setOpen } = useSidebar()

  const visibleProjectWorkspaces = showAllWorkspaces
    ? projectWorkspaces
    : projectWorkspaces.slice(0, VISIBLE_WORKSPACES_DEFAULT)
  const hasMoreWorkspaces =
    projectWorkspaces.length > VISIBLE_WORKSPACES_DEFAULT

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

  const requestDeleteChat = (c: WorkspaceConversation) => {
    setDeletePrompt(c)
  }

  const executeDeleteChat = () => {
    const c = deletePrompt
    if (!c) return
    setDeletePrompt(null)
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
      <NewSimpleChatSidebarItem pathname={pathname} />
      {personalWorkspace ? (
        <WorkspaceConversationGroup
          key={personalWorkspace.id}
          workspace={personalWorkspace}
          conversations={conversationsByWorkspace[personalWorkspace.id] ?? []}
          pathname={pathname}
          routerSearchStr={routerSearchStr}
          activeWorkspaceId={activeWorkspaceId}
          expandedChats={expandedChatsByWs[personalWorkspace.id] ?? true}
          onExpandChats={() =>
            setExpandedChatsByWs((prev) => ({
              ...prev,
              [personalWorkspace.id]: true,
            }))
          }
          onRename={openRename}
          onDelete={requestDeleteChat}
          deleteTargetId={deleteTargetId}
          isTauriRuntime={isTauriRuntime}
          navigate={navigate}
          createConversationInWorkspace={createConversationInWorkspace}
          setActiveWorkspaceId={setActiveWorkspaceId}
          hideFolderSettings
        />
      ) : null}
      {projectWorkspaces.length === 0 ? (
        <p className="text-sidebar-foreground/60 px-2 py-3 text-xs leading-relaxed">
          Open the <span className="font-medium">dashboard</span> from the logo
          or add a folder workspace there to list project chats here.
        </p>
      ) : (
        <>
          {visibleProjectWorkspaces.map((ws) => (
            <WorkspaceConversationGroup
              key={ws.id}
              workspace={ws}
              conversations={conversationsByWorkspace[ws.id] ?? []}
              pathname={pathname}
              routerSearchStr={routerSearchStr}
              activeWorkspaceId={activeWorkspaceId}
              expandedChats={expandedChatsByWs[ws.id] ?? false}
              onExpandChats={() =>
                setExpandedChatsByWs((prev) => ({
                  ...prev,
                  [ws.id]: true,
                }))
              }
              onRename={openRename}
              onDelete={requestDeleteChat}
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
        className="h-14 shrink-0 gap-0 border-b border-sidebar-border/50 p-0"
        data-tauri-drag-region={isTauriRuntime ? true : undefined}
      >
        <div className="flex h-full w-full items-center justify-between gap-2 px-2 md:px-3">
          <SidebarMenu data-tauri-drag-region={isTauriRuntime ? false : undefined} className="min-w-0 flex-1">
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                tooltip="Braian home"
                className="h-9 min-h-9 py-0 pr-2 pl-1 group-data-[collapsible=icon]:!size-11 group-data-[collapsible=icon]:!min-h-11 group-data-[collapsible=icon]:!min-w-11 group-data-[collapsible=icon]:!p-1.5"
              >
                <Link to="/dashboard" search={{ tab: 'overview' }}>
                  <img
                    src="/braian-logo.png"
                    alt=""
                    width={32}
                    height={32}
                    draggable={false}
                    className="size-8 shrink-0 object-contain group-data-[collapsible=icon]:size-11"
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate text-left text-sm font-semibold leading-tight">
                    Braian
                  </span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 text-sidebar-foreground/70 hover:text-sidebar-foreground"
            onClick={() => setOpen(false)}
            title="Close Sidebar"
          >
            <PanelLeftClose className="size-4" />
          </Button>
        </div>
      </SidebarHeader>
      <SidebarContent>
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
        <SidebarSeparator className="mx-0" />
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={userPageActive}
              tooltip="Your profile"
            >
              <Link to="/user" search={{ tab: 'profile' }}>
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

      <Dialog
        open={deletePrompt !== null}
        onOpenChange={(open) => {
          if (!open) setDeletePrompt(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete chat?</DialogTitle>
            <DialogDescription>
              Delete{' '}
              <span className="text-foreground font-medium">
                “{deletePrompt?.title ?? ''}”
              </span>
              ? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeletePrompt(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={executeDeleteChat}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Sidebar>
  )
}
