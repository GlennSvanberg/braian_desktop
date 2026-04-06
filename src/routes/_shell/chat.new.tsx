import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'

import { useWorkspace } from '@/components/app/workspace-context'
import { PERSONAL_WORKSPACE_SESSION_ID } from '@/lib/chat-sessions/detached'
import { requestConversationListRefresh } from '@/lib/conversation-list-refresh'
import { isTauri } from '@/lib/tauri-env'
import { conversationCreate } from '@/lib/workspace-api'

export const Route = createFileRoute('/_shell/chat/new')({
  component: NewChatPage,
})

function NewChatPage() {
  const navigate = useNavigate()
  const {
    activeWorkspaceId,
    workspaces,
    loading: workspacesLoading,
    setActiveWorkspaceId,
  } = useWorkspace()
  const [error, setError] = useState<string | null>(null)
  const workspacePickRef = useRef({ activeWorkspaceId, workspaces })
  workspacePickRef.current = { activeWorkspaceId, workspaces }

  useEffect(() => {
    if (!isTauri()) return
    if (workspacesLoading) return
    let cancelled = false
    void (async () => {
      try {
        const { activeWorkspaceId: wid, workspaces: list } =
          workspacePickRef.current
        const inList = Boolean(wid) && list.some((w) => w.id === wid)
        const workspaceId = inList ? wid : PERSONAL_WORKSPACE_SESSION_ID
        const c = await conversationCreate(workspaceId)
        if (cancelled) return
        setActiveWorkspaceId(workspaceId)
        await requestConversationListRefresh()
        navigate({
          to: '/chat/$conversationId',
          params: { conversationId: c.id },
          replace: true,
        })
      } catch (e) {
        if (cancelled) return
        console.error(e)
        setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [navigate, workspacesLoading, setActiveWorkspaceId])

  if (!isTauri()) {
    return (
      <div className="text-text-3 flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm">
        <p className="text-text-1 font-medium">Simple chats need the desktop app</p>
        <p className="max-w-md leading-relaxed">
          Open Braian Desktop to create saved simple chats. In the browser preview you can still
          browse mock workspaces from the sidebar.
        </p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-text-3 flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm">
        <p className="text-destructive font-medium">Could not start a chat</p>
        <p className="max-w-md">{error}</p>
      </div>
    )
  }

  return (
    <div className="text-text-3 flex min-h-0 flex-1 items-center justify-center p-6 text-sm">
      Starting a new chat…
    </div>
  )
}
