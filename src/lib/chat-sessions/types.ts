import type { SerializableModelRequestSnapshot } from '@/lib/ai/chat-turn-args'
import type {
  DocumentCanvasSelectionContext,
  ReasoningMode,
} from '@/lib/ai/types'
import type { WorkspaceArtifactPayload } from '@/lib/artifacts/types'
import type { AgentMode } from '@/lib/workspace-api'

export type ChatRole = 'user' | 'assistant'

export type { ReasoningMode } from '@/lib/ai/types'

export type AssistantTextPart = { type: 'text'; text: string }

export type AssistantThinkingPart = {
  type: 'thinking'
  text: string
  status: 'streaming' | 'done'
}

export type AssistantToolPart = {
  type: 'tool'
  toolCallId: string
  toolName: string
  argsText: string
  status: 'streaming' | 'done'
  result?: string
}

export type AssistantPart =
  | AssistantTextPart
  | AssistantThinkingPart
  | AssistantToolPart

export type UserChatMessage = {
  id: string
  role: 'user'
  content: string
}

export type AssistantChatMessage = {
  id: string
  role: 'assistant'
  content: string
  status?: 'streaming' | 'complete'
  /** Ordered segments (text + tool calls). If absent, render `content` as Markdown only. */
  parts?: AssistantPart[]
}

export type ChatMessage = UserChatMessage | AssistantChatMessage

/** Queued composer send while an assistant turn is in flight. */
export type PendingUserTurn = {
  content: string
  canvasSelection?: DocumentCanvasSelectionContext
}

export type ArtifactPayload = WorkspaceArtifactPayload

/** Workspace-relative path and optional label for chat / model context. */
export type ContextFileEntry = {
  relativePath: string
  displayName?: string
  addedAtMs?: number
}

/** Another saved conversation pinned for model context (same workspace). */
export type ContextConversationEntry = {
  conversationId: string
  title?: string
  addedAtMs?: number
}

export type ChatThreadState = {
  messages: ChatMessage[]
  artifactOpen: boolean
  artifactPayload: ArtifactPayload | null
  draft: string
  /** Assistant turn in progress for this thread. */
  generating: boolean
  /** FIFO user messages to send after the current assistant turn finishes (in-memory only). */
  pendingUserMessages: PendingUserTurn[]
  /** Files pinned to this conversation for model context (paths relative to workspace root). */
  contextFiles: ContextFileEntry[]
  /** Other conversations pinned for model context (transcript injected on send). */
  contextConversations: ContextConversationEntry[]
  /** Persisted with the conversation when saved. */
  agentMode: AgentMode
  /** When true, inject workspace dashboard builder instructions and tools for this chat. */
  appHarnessEnabled: boolean
  /** Persisted: minimize vs enable provider-native chain-of-thought. */
  reasoningMode: ReasoningMode
  /** Payload assembled for the most recently started model turn (debug / context manager). */
  lastModelRequestSnapshot: SerializableModelRequestSnapshot | null
}

export const DEFAULT_CHAT_THREAD: ChatThreadState = {
  messages: [],
  artifactOpen: false,
  artifactPayload: null,
  draft: '',
  generating: false,
  pendingUserMessages: [],
  contextFiles: [],
  contextConversations: [],
  agentMode: 'document',
  appHarnessEnabled: false,
  reasoningMode: 'fast',
  lastModelRequestSnapshot: null,
}
