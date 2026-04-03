export type {
  ChatStreamChunk,
  ChatStreamProvider,
  ChatTurnContext,
  PriorChatMessage,
} from './types'
export { streamMockChatTurn } from './mock-chat-stream'
import { streamMockChatTurn } from './mock-chat-stream'
import { streamTanStackChatTurn } from './tanstack-chat-stream'

import type { ChatStreamChunk, ChatTurnContext, PriorChatMessage } from './types'

function useMockAi(): boolean {
  try {
    return (
      import.meta.env.DEV &&
      typeof globalThis.localStorage !== 'undefined' &&
      globalThis.localStorage.getItem('braian.mockAi') === '1'
    )
  } catch {
    return false
  }
}

export async function* streamChatTurn(
  userText: string,
  signal?: AbortSignal,
  context?: ChatTurnContext,
  priorMessages?: PriorChatMessage[],
): AsyncGenerator<ChatStreamChunk> {
  if (useMockAi()) {
    yield* streamMockChatTurn(userText, signal, context)
    return
  }
  yield* streamTanStackChatTurn(userText, signal, context, priorMessages)
}
