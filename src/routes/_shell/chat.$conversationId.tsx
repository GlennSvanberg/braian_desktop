import { useEffect } from 'react'
import { createFileRoute, notFound, useNavigate } from '@tanstack/react-router'

import { ChatWorkbench } from '@/components/app/chat-workbench'
import { useWorkspace } from '@/components/app/workspace-context'
import { conversationOpen } from '@/lib/workspace-api'

export const Route = createFileRoute('/_shell/chat/$conversationId')({
  component: ChatPage,
  beforeLoad: async ({ params }) => {
    const opened = await conversationOpen(params.conversationId)
    if (!opened) {
      throw notFound()
    }
    return { conversation: opened.conversation, initialThread: opened.thread }
  },
})

function ChatPage() {
  const navigate = useNavigate()
  const { activeWorkspaceId, loading: workspaceLoading } = useWorkspace()
  const { conversation, initialThread } = Route.useRouteContext({
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
      initialThread={initialThread}
    />
  )
}
