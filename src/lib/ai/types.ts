import type { WorkspaceArtifactPayload } from '@/lib/artifacts/types'

export type ChatTurnContext = {
  workspaceId: string
  conversationId: string | null
}

export type PriorChatMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type ChatStreamChunk =
  | { type: 'text-delta'; text: string }
  | {
      type: 'artifact'
      payload: WorkspaceArtifactPayload
    }
  | { type: 'done' }

export type ChatStreamProvider = (
  userText: string,
  signal?: AbortSignal,
  context?: ChatTurnContext,
  priorMessages?: PriorChatMessage[],
) => AsyncIterable<ChatStreamChunk>
