export type {
  ChatStreamChunk,
  ChatStreamProvider,
  ChatTurnContext,
  PriorChatMessage,
} from './types'
export { streamMockChatTurn } from './mock-chat-stream'
import { streamMockChatTurn } from './mock-chat-stream'
import { isMockAiMode } from './mock-mode'
import { streamTanStackChatTurn } from './tanstack-chat-stream'

import type { ChatStreamChunk, ChatTurnContext, PriorChatMessage } from './types'

export { isMockAiMode } from './mock-mode'

export async function* streamChatTurn(
  userText: string,
  signal?: AbortSignal,
  context?: ChatTurnContext,
  priorMessages?: PriorChatMessage[],
): AsyncGenerator<ChatStreamChunk> {
  if (isMockAiMode()) {
    yield* streamMockChatTurn(userText, signal, context)
    return
  }
  yield* streamTanStackChatTurn(userText, signal, context, priorMessages)
}
