import { useRouterState } from '@tanstack/react-router'

import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { getConversationById } from '@/lib/mock-workspace-data'

import { useWorkspace } from './workspace-context'

export function AppHeader() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { activeWorkspace } = useWorkspace()

  const chatMatch = pathname.match(/^\/chat\/([^/]+)/)
  const conversationId = chatMatch?.[1]
  const isNewChatRoute = pathname === '/chat/new'
  const conversation =
    conversationId && !isNewChatRoute
      ? getConversationById(conversationId)
      : undefined

  const isDashboard = pathname.startsWith('/dashboard')
  const isHome = pathname === '/'

  const title = (() => {
    if (isHome) return 'Welcome'
    if (isDashboard) return 'Dashboard'
    if (isNewChatRoute) return 'New chat'
    if (conversation) return conversation.title
    if (conversationId) return 'Conversation'
    return 'Braian'
  })()

  const subtitle = (() => {
    if (isHome) return activeWorkspace.name
    if (isDashboard) return `${activeWorkspace.name} · Overview`
    if (isNewChatRoute) return `${activeWorkspace.name} · Chat`
    if (conversation) return `${activeWorkspace.name} · Chat`
    return activeWorkspace.name
  })()

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background/85 px-2 backdrop-blur-md supports-backdrop-filter:bg-background/70 md:px-3">
      <SidebarTrigger className="-ml-0.5" />
      <Separator
        orientation="vertical"
        className="hidden h-6 md:block"
        decorative
      />
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 py-1">
        <h1 className="text-text-1 truncate text-sm font-semibold tracking-tight md:text-base">
          {title}
        </h1>
        <p className="text-text-3 truncate text-xs">{subtitle}</p>
      </div>
    </header>
  )
}
