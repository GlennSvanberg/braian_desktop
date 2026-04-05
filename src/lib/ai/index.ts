export type {
  ChatStreamChunk,
  ChatStreamProvider,
  ChatTurnContext,
  ChatTurnKind,
  PriorChatMessage,
} from './types'
export { streamMockChatTurn } from './mock-chat-stream'
import { streamMockChatTurn } from './mock-chat-stream'
import { isMockAiMode } from './mock-mode'
import { streamTanStackChatTurn } from './tanstack-chat-stream'
import type { BuildTanStackChatTurnArgsResult } from './chat-turn-args'

import type { ChatStreamChunk, ChatTurnContext, PriorChatMessage } from './types'

export { isMockAiMode } from './mock-mode'

export type StreamChatTurnOptions = {
  prebuiltTanStackArgs?: BuildTanStackChatTurnArgsResult
}

export async function* streamChatTurn(
  userText: string,
  signal?: AbortSignal,
  context?: ChatTurnContext,
  priorMessages?: PriorChatMessage[],
  options?: StreamChatTurnOptions,
): AsyncGenerator<ChatStreamChunk> {
  if (isMockAiMode()) {
    yield* streamMockChatTurn(userText, signal, context)
    return
  }
  yield* streamTanStackChatTurn(
    userText,
    signal,
    context,
    priorMessages,
    {
      prebuiltArgs: options?.prebuiltTanStackArgs,
    },
  )
}
