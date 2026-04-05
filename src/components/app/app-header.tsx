import { getCurrentWindow } from '@tauri-apps/api/window'
import { useMatches, useRouterState } from '@tanstack/react-router'

import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { isTauri } from '@/lib/tauri-env'
import type { ConversationDto } from '@/lib/workspace-api'

import { useWorkspace } from './workspace-context'
import { WindowControls } from './window-controls'

type ChatRouteContext = { conversation: ConversationDto }

export function AppHeader() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
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
  const workspaceSettingsMatch = pathname.match(
    /^\/workspace\/([^/]+)\/settings$/,
  )
  const isWorkspaceSettings = Boolean(workspaceSettingsMatch)

  const title = (() => {
    if (isHome) return 'Welcome'
    if (isDashboard) return 'Dashboard'
    if (isSettings) return 'Settings'
    if (isWorkspaceSettings) return 'Workspace settings'
    if (isNewChatRoute) return 'New agent'
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
    return 'Braian'
  })()

  const subtitle = (() => {
    const wsName = activeWorkspace?.name ?? 'Workspace'
    if (isHome) return wsName
    if (isSettings) return 'AI provider & API key'
    if (isWorkspaceSettings && workspaceSettingsMatch) {
      const id = workspaceSettingsMatch[1]
      const w = workspaces.find((x) => x.id === id)
      return `${w?.name ?? 'Workspace'} · Connections (MCP)`
    }
    if (isDashboard) return `${wsName} · Overview`
    if (isNewChatRoute) return 'No workspace · move when ready'
    if (routeConversation) return `${wsName} · Chat`
    return wsName
  })()

  const tauriChrome = isTauri()

  const noDrag = tauriChrome ? ({ 'data-tauri-drag-region': false } as const) : {}

  return (
    <header
      className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background/85 px-2 backdrop-blur-md supports-backdrop-filter:bg-background/70 md:px-3"
      data-tauri-drag-region={tauriChrome ? true : undefined}
    >
      <SidebarTrigger className="-ml-0.5" {...noDrag} />
      <Separator
        orientation="vertical"
        className="hidden h-6 md:block"
        decorative
        {...noDrag}
      />
      <div
        className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 py-1"
        onDoubleClick={
          tauriChrome
            ? () => {
                void getCurrentWindow().toggleMaximize()
              }
            : undefined
        }
      >
        <h1 className="text-text-1 truncate text-sm font-semibold tracking-tight md:text-base">
          {title}
        </h1>
        <p className="text-text-3 truncate text-xs">{subtitle}</p>
      </div>
      {tauriChrome ? <WindowControls /> : null}
    </header>
  )
}
