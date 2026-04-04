import { useState } from 'react'
import {
  LayoutDashboard,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  PanelLeftIcon,
  Plus,
  Settings,
  Trash2,
} from 'lucide-react'
import {
  Link,
  useNavigate,
  useRouter,
  useRouterState,
} from '@tanstack/react-router'

import { Button } from '@/components/ui/button'
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
import { chatSessionKey } from '@/lib/chat-sessions/keys'
import { useSessionGenerating } from '@/lib/chat-sessions/store'
import { conversationDelete, conversationSetTitle } from '@/lib/workspace-api'

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

export function AppSidebar() {
  const router = useRouter()
  const navigate = useNavigate()
  const { activeWorkspaceId, activeWorkspace, conversations, refreshConversations } =
    useWorkspace()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameDraft, setRenameDraft] = useState('')
  const [renameTargetId, setRenameTargetId] = useState<string | null>(null)
  const [renameBusy, setRenameBusy] = useState(false)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)

  const openRename = (c: WorkspaceConversation) => {
    setRenameTargetId(c.id)
    setRenameDraft(c.title)
    setRenameOpen(true)
  }

  const submitRename = () => {
    if (!activeWorkspaceId || !renameTargetId) return
    const trimmed = renameDraft.trim()
    if (!trimmed) return
    setRenameBusy(true)
    void (async () => {
      try {
        await conversationSetTitle({
          id: renameTargetId,
          workspaceId: activeWorkspaceId,
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
    if (!activeWorkspaceId) return
    const ok = window.confirm(
      `Delete “${c.title}”? This cannot be undone.`,
    )
    if (!ok) return
    setDeleteTargetId(c.id)
    void (async () => {
      try {
        await conversationDelete({
          id: c.id,
          workspaceId: activeWorkspaceId,
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
                      onRename={openRename}
                      onDelete={confirmDelete}
                      deletePending={deleteTargetId === c.id}
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
