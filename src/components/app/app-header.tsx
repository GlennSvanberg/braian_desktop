import { getCurrentWindow } from '@tauri-apps/api/window'
import { useMatches, useRouterState } from '@tanstack/react-router'
import { FolderTree } from 'lucide-react'

import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { isTauri } from '@/lib/tauri-env'
import type { ConversationDto } from '@/lib/workspace-api'

import { useOptionalShellHeaderToolbar } from './shell-header-toolbar'
import { parseDashboardTabFromSearchStr } from './workspace-dashboard'
import { useWorkspace } from './workspace-context'
import { WindowControls } from './window-controls'
import { Button } from '@/components/ui/button'

type ChatRouteContext = { conversation: ConversationDto }

function userTabFromSearchStr(searchStr: string): 'profile' | 'ai' {
  const raw = searchStr.startsWith('?') ? searchStr.slice(1) : searchStr
  return new URLSearchParams(raw).get('tab') === 'ai' ? 'ai' : 'profile'
}

/**
 * When a pane is collapsed from its own header, we only show an **expand** control
 * here (no duplicate collapse). Collapse stays on the panel chrome.
 */
function ShellLeftPaneControls({
  className,
  ...rest
}: React.ComponentProps<'div'>) {
  const {
    activeWorkspace,
    activeWorkspaceId,
    workspaces,
    fileTreeOpen,
    setFileTreeOpen,
  } = useWorkspace()

  const folderRootPath =
    activeWorkspace?.rootPath ??
    workspaces.find((w) => w.id === activeWorkspaceId)?.rootPath ??
    ''
  const hasFolderExplorer = folderRootPath.length > 0

  const showFileExpand = hasFolderExplorer && !fileTreeOpen

  if (!showFileExpand) return null

  return (
    <>
      <div className={cn('flex items-center gap-1', className)} {...rest}>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 -ml-0.5"
          title="Show File Explorer"
          onClick={() => setFileTreeOpen(true)}
        >
          <FolderTree className="size-4" />
          <span className="sr-only">Show File Explorer</span>
        </Button>
      </div>
      <Separator
        orientation="vertical"
        className="hidden h-6 md:block"
        decorative
        {...rest}
      />
    </>
  )
}

export function AppHeader() {
  const { toolbar: shellToolbar } = useOptionalShellHeaderToolbar() ?? {
    toolbar: null,
  }
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const dashboardSearchStr = useRouterState({
    select: (s) =>
      s.location.pathname.startsWith('/dashboard') ? s.location.searchStr : '',
  })
  const userSearchStr = useRouterState({
    select: (s) =>
      s.location.pathname === '/user' || s.location.pathname === '/user/'
        ? s.location.searchStr
        : '',
  })
  const matches = useMatches()
  const { activeWorkspace, conversationsByWorkspace, workspaces } =
    useWorkspace()

  const chatMatch = matches.find(
    (m) => m.routeId === '/_shell/chat/$conversationId',
  )
  const routeConversation =
    chatMatch?.context &&
    typeof chatMatch.context === 'object' &&
    'conversation' in chatMatch.context
      ? (chatMatch.context as ChatRouteContext).conversation
      : undefined

  const isNewChatRoute = pathname === '/chat/new'
  const conversationIdMatch = pathname.match(/^\/chat\/([^/]+)/)
  const conversationIdFromPath = conversationIdMatch?.[1]

  const isDashboard = pathname.startsWith('/dashboard')
  const isHome = pathname === '/'
  const isSettings = pathname === '/settings'
  const isUserPage =
    pathname === '/user' || pathname === '/user/'
  const userTab = userTabFromSearchStr(userSearchStr)
  const workspaceSettingsMatch = pathname.match(
    /^\/workspace\/([^/]+)\/settings$/,
  )
  const isWorkspaceSettings = Boolean(workspaceSettingsMatch)
  const workspaceWebappSettingsMatch = pathname.match(
    /^\/workspace\/([^/]+)\/webapp\/settings$/,
  )
  const workspaceWebappMatch = pathname.match(
    /^\/workspace\/([^/]+)\/webapp$/,
  )

  const wsName = activeWorkspace?.name ?? 'Workspace'
  const isChatRoute =
    isNewChatRoute ||
    (Boolean(conversationIdFromPath) && conversationIdFromPath !== 'new')

  const chatViewTitle = (() => {
    if (isNewChatRoute) return 'New chat'
    if (
      conversationIdFromPath &&
      conversationIdFromPath !== 'new' &&
      activeWorkspace
    ) {
      const fromList = Object.values(conversationsByWorkspace)
        .flat()
        .find((c) => c.id === conversationIdFromPath)?.title
      if (fromList) return fromList
    }
    if (routeConversation) return routeConversation.title
    if (conversationIdFromPath && conversationIdFromPath !== 'new') {
      return 'Conversation'
    }
    return 'Chat'
  })()

  const title = (() => {
    if (isChatRoute) return activeWorkspace?.name ?? 'No workspace'
    if (isHome) return wsName
    if (isDashboard) return wsName
    if (isUserPage) return 'You'
    if (isSettings) return 'Settings'
    if (isWorkspaceSettings && workspaceSettingsMatch) {
      const id = workspaceSettingsMatch[1]
      const w = workspaces.find((x) => x.id === id)
      return w?.name ?? 'Workspace'
    }
    if (workspaceWebappSettingsMatch) {
      const id = workspaceWebappSettingsMatch[1]
      const w = workspaces.find((x) => x.id === id)
      return w?.name ?? wsName
    }
    if (workspaceWebappMatch) {
      const id = workspaceWebappMatch[1]
      const w = workspaces.find((x) => x.id === id)
      return w?.name ?? wsName
    }
    return 'Braian'
  })()

  const subtitle = (() => {
    if (isChatRoute) return chatViewTitle
    if (isHome) return 'Welcome'
    if (isUserPage) {
      return userTab === 'ai'
        ? 'AI provider, model & API key'
        : 'Profile & preferences'
    }
    if (isSettings) return 'AI provider & API key'
    if (isWorkspaceSettings && workspaceSettingsMatch) {
      return 'Workspace settings · Connections (MCP)'
    }
    if (isDashboard) {
      const tab = parseDashboardTabFromSearchStr(dashboardSearchStr)
      if (tab === 'app-settings') return 'App settings'
      if (tab === 'apps') return 'Apps'
      if (tab === 'workspace-settings') return 'Workspace settings'
      if (tab === 'memory') return 'Memory'
      return 'Dashboard'
    }
    if (workspaceWebappSettingsMatch) {
      return 'App settings · Template, deps, preview'
    }
    if (workspaceWebappMatch) {
      return 'Published app'
    }
    return wsName
  })()

  const workspaceLedHeader =
    isChatRoute || isHome || isDashboard || isWorkspaceSettings ||
    Boolean(workspaceWebappSettingsMatch) || Boolean(workspaceWebappMatch)

  const tauriChrome = isTauri()

  const noDrag = tauriChrome ? ({ 'data-tauri-drag-region': false } as const) : {}

  return (
    <header
      className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background/85 px-2 backdrop-blur-md supports-backdrop-filter:bg-background/70 md:px-3"
      data-tauri-drag-region={tauriChrome ? true : undefined}
    >
      <ShellLeftPaneControls {...noDrag} />
      <div
        className="flex min-w-0 max-w-[min(100%,40%)] shrink-0 flex-col justify-center gap-0.5 py-1 sm:max-w-[min(100%,50%)]"
        onDoubleClick={
          tauriChrome
            ? () => {
                void getCurrentWindow().toggleMaximize()
              }
            : undefined
        }
      >
        <h1
          className={cn(
            'text-text-1 truncate font-semibold tracking-tight',
            workspaceLedHeader
              ? 'text-base md:text-lg'
              : 'text-sm md:text-base',
          )}
        >
          {title}
        </h1>
        <p className="text-text-3 truncate text-xs leading-snug">{subtitle}</p>
      </div>
      <div
        className="flex min-h-0 min-w-0 flex-1 items-center justify-end gap-2 py-0.5"
        {...noDrag}
      >
        {shellToolbar ? (
          <div className="flex min-w-0 max-w-full flex-1 items-center justify-end overflow-x-auto overscroll-x-contain [-ms-overflow-style:none] [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border/80">
            {shellToolbar}
          </div>
        ) : null}
        {tauriChrome ? (
          <div className="shrink-0">
            <WindowControls />
          </div>
        ) : null}
      </div>
    </header>
  )
}
