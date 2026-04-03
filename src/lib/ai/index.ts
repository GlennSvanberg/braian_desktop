export type {
  ChatStreamChunk,
  ChatStreamProvider,
  ChatTurnContext,
} from './types'
export { streamMockChatTurn } from './mock-chat-stream'

import { streamMockChatTurn } from './mock-chat-stream'

/** Swap this binding when wiring a real LLM adapter. */
export const streamChatTurn = streamMockChatTurn
