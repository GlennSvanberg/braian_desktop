import { useEffect } from 'react'
import { createFileRoute, notFound } from '@tanstack/react-router'

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
  const { activeWorkspaceId, loading: workspaceLoading, setActiveWorkspaceId } =
    useWorkspace()
  const { conversation, initialThread } = Route.useRouteContext()

  useEffect(() => {
    if (workspaceLoading) return
    if (conversation.workspaceId !== activeWorkspaceId) {
      setActiveWorkspaceId(conversation.workspaceId)
    }
  }, [
    workspaceLoading,
    conversation.workspaceId,
    activeWorkspaceId,
    setActiveWorkspaceId,
  ])

  return (
    <ChatWorkbench
      key={conversation.id}
      conversationId={conversation.id}
      conversationMeta={conversation}
      initialThread={initialThread}
    />
  )
}
