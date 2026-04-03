import { createFileRoute, notFound } from '@tanstack/react-router'

import { ChatWorkbench } from '@/components/app/chat-workbench'
import { getConversationById } from '@/lib/mock-workspace-data'

export const Route = createFileRoute('/_shell/chat/$conversationId')({
  component: ChatPage,
  beforeLoad: ({ params }) => {
    if (!getConversationById(params.conversationId)) {
      throw notFound()
    }
  },
})

function ChatPage() {
  const { conversationId } = Route.useParams()
  return <ChatWorkbench conversationId={conversationId} />
}

