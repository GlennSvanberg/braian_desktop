import type { WorkspaceArtifactPayload } from '@/lib/artifacts/types'
import type { AgentMode } from '@/lib/workspace-api'

/** User-selected span for a canvas-scoped request (inline mini-prompt). */
export type DocumentCanvasSelectionContext = {
  /** Markdown excerpt from the selection (from the editor). */
  selectedMarkdown: string
  /** When true, prefer patch tools that only touch this region. */
  sectionOnly?: boolean
}

/** In-memory document canvas at send time (includes edits not yet flushed to disk). */
export type DocumentCanvasSnapshot = {
  body: string
  title?: string
  /** Matches `DocumentArtifactPayload.canvasRevision` for optimistic patch locking. */
  revision: number
  /** Selection from inline canvas prompt, if any. */
  selection?: DocumentCanvasSelectionContext
  /**
   * Short instruction from the selection UI (before composition into full user message).
   * Binds pronouns in the instruction to `selection`.
   */
  selectionUserInstruction?: string
}

/** Resolved UTF-8 text for one workspace file passed to the model this turn. */
export type ContextFileForModel = {
  relativePath: string
  displayName?: string
  text: string
  /** True when read was truncated by byte or total-char budget. */
  fileTruncated?: boolean
}

export type ChatTurnKind = 'default' | 'profile'

export type ChatTurnContext = {
  workspaceId: string
  conversationId: string | null
  /** Profile coach chat (sidebar → You): only `update_user_profile` tool. */
  turnKind?: ChatTurnKind
  /** Document canvas vs coding agent (files + commands under workspace). */
  agentMode?: AgentMode
  /** Workspace dashboard builder tools + instructions (App segment in chat toolbar). */
  appHarnessEnabled?: boolean
  /** Called when the model enables code capabilities (e.g. `switch_to_code_agent` tool). */
  onAgentModeChange?: (mode: AgentMode) => void
  /** Called when the model enables workspace dashboard tools (e.g. `switch_to_app_builder`). */
  onAppHarnessEnabledChange?: (enabled: boolean) => void
  /** When set, the model must treat this as the latest canvas markdown for this turn. */
  documentCanvasSnapshot?: DocumentCanvasSnapshot | null
  /** Workspace files loaded for this user turn (paths relative to workspace root). */
  contextFiles?: ContextFileForModel[]
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
  | {
      type: 'tool-start'
      toolCallId: string
      toolName: string
    }
  | {
      type: 'tool-args-delta'
      toolCallId: string
      delta: string
    }
  | {
      type: 'tool-end'
      toolCallId: string
      toolName: string
      input?: unknown
      result?: string
    }
  | { type: 'done' }

export type ChatStreamProvider = (
  userText: string,
  signal?: AbortSignal,
  context?: ChatTurnContext,
  priorMessages?: PriorChatMessage[],
) => AsyncIterable<ChatStreamChunk>
