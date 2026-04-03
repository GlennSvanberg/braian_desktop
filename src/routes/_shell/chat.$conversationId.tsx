import { useEffect } from 'react'
import { createFileRoute, notFound, useNavigate } from '@tanstack/react-router'

import { ChatWorkbench } from '@/components/app/chat-workbench'
import { useWorkspace } from '@/components/app/workspace-context'
import { conversationGet } from '@/lib/workspace-api'

export const Route = createFileRoute('/_shell/chat/$conversationId')({
  component: ChatPage,
  beforeLoad: async ({ params }) => {
    const conversation = await conversationGet(params.conversationId)
    if (!conversation) {
      throw notFound()
    }
    return { conversation }
  },
})

function ChatPage() {
  const navigate = useNavigate()
  const { activeWorkspaceId, loading: workspaceLoading } = useWorkspace()
  const { conversation } = Route.useRouteContext({
    from: '/_shell/chat/$conversationId',
  })

  useEffect(() => {
    if (workspaceLoading || !activeWorkspaceId) return
    if (conversation.workspaceId !== activeWorkspaceId) {
      navigate({ to: '/dashboard' })
    }
  }, [
    workspaceLoading,
    conversation.workspaceId,
    activeWorkspaceId,
    navigate,
  ])

  return (
    <ChatWorkbench
      conversationId={conversation.id}
      conversationMeta={conversation}
    />
  )
}
