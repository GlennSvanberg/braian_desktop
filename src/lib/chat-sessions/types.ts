import type { SerializableModelRequestSnapshot } from '@/lib/ai/chat-turn-args'
import type { WorkspaceArtifactPayload } from '@/lib/artifacts/types'
import type { AgentMode } from '@/lib/workspace-api'

export type ChatRole = 'user' | 'assistant'

export type AssistantTextPart = { type: 'text'; text: string }

export type AssistantToolPart = {
  type: 'tool'
  toolCallId: string
  toolName: string
  argsText: string
  status: 'streaming' | 'done'
  result?: string
}

export type AssistantPart = AssistantTextPart | AssistantToolPart

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

export type ArtifactPayload = WorkspaceArtifactPayload

/** Workspace-relative path and optional label for chat / model context. */
export type ContextFileEntry = {
  relativePath: string
  displayName?: string
  addedAtMs?: number
}

export type ChatThreadState = {
  messages: ChatMessage[]
  artifactOpen: boolean
  artifactPayload: ArtifactPayload | null
  draft: string
  /** Assistant turn in progress for this thread. */
  generating: boolean
  /** FIFO user texts to send after the current assistant turn finishes (in-memory only). */
  pendingUserMessages: string[]
  /** Files pinned to this conversation for model context (paths relative to workspace root). */
  contextFiles: ContextFileEntry[]
  /** Persisted with the conversation when saved. */
  agentMode: AgentMode
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
  agentMode: 'document',
  lastModelRequestSnapshot: null,
}
