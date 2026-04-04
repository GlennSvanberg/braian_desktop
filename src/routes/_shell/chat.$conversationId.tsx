import { useEffect } from 'react'
import { createFileRoute, notFound, useRouter } from '@tanstack/react-router'

import { ChatWorkbench } from '@/components/app/chat-workbench'
import { useWorkspace } from '@/components/app/workspace-context'
import { conversationOpen, conversationSetUnread } from '@/lib/workspace-api'

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
  const router = useRouter()
  const {
    activeWorkspaceId,
    loading: workspaceLoading,
    setActiveWorkspaceId,
    refreshConversations,
  } = useWorkspace()
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

  useEffect(() => {
    if (!conversation.unread) return
    void (async () => {
      try {
        await conversationSetUnread({
          id: conversation.id,
          workspaceId: conversation.workspaceId,
          unread: false,
        })
        await refreshConversations()
        await router.invalidate()
      } catch (e) {
        console.error(e)
      }
    })()
  }, [
    conversation.id,
    conversation.unread,
    conversation.workspaceId,
    refreshConversations,
    router,
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
