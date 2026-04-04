import { createFileRoute } from '@tanstack/react-router'

import { ChatWorkbench } from '@/components/app/chat-workbench'

export const Route = createFileRoute('/_shell/chat/new')({
  component: NewChatPage,
})

function NewChatPage() {
  return <ChatWorkbench conversationId={null} useDetachedSession />
}
