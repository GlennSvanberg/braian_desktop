/** Compatibility instruction file at workspace root (agent workspaces). */
export const AGENTS_RELATIVE_PATH = 'AGENTS.md'

/** Max bytes read from AGENTS.md when injecting into chat context. */
export const AGENTS_INJECT_MAX_BYTES = 24 * 1024

/** Per-conversation rolling summary + open loops (short-term memory compaction). */
export const CONVERSATION_SUMMARIES_DIR = '.braian/conversation-summaries'

export function conversationSummaryRelativePath(conversationId: string): string {
  return `${CONVERSATION_SUMMARIES_DIR}/${conversationId}.summary.json`
}

/** Saved transcript JSON (full history); relative to workspace root. */
export function conversationTranscriptRelativePath(conversationId: string): string {
  return `.braian/conversations/${conversationId}.json`
}

/** Max bytes when loading a conversation JSON for archive search / span tools. */
export const CONVERSATION_TRANSCRIPT_READ_MAX_BYTES = 8 * 1024 * 1024

/** Workspace-relative JSON: last-reviewed message ids per conversation. */
export const MEMORY_REVIEW_STATE_RELATIVE_PATH = '.braian/memory-review-state.json'

/** Idle debounce before running auto memory review (ms). */
export const MEMORY_REVIEW_DEBOUNCE_MS = 3 * 60 * 1000

/** Minimum time between successful auto reviews per workspace (ms). */
export const MEMORY_REVIEW_MIN_INTERVAL_MS = 20 * 60 * 1000

/** Max chat messages to include in review transcript (from end). */
export const MEMORY_REVIEW_MAX_MESSAGES = 40

/** Structured semantic memory root (JSON files per record). */
export const SEMANTIC_MEMORY_ROOT = '.braian/memory'

export const SEMANTIC_MEMORY_KIND_DIRS = [
  'facts',
  'decisions',
  'preferences',
  'episodes',
  'patterns',
] as const

export type SemanticMemoryKindDir = (typeof SEMANTIC_MEMORY_KIND_DIRS)[number]

/** Human overview generated from structured records. */
export const SEMANTIC_MEMORY_INDEX_RELATIVE_PATH = '.braian/memory/index.md'

/** Max bytes injected as structured semantic memory system text. */
export const SEMANTIC_MEMORY_INJECT_MAX_BYTES = 24 * 1024

/** Pending promotion suggestions (file-backed queue). */
export const SEMANTIC_MEMORY_SUGGESTIONS_DIR = '.braian/memory/_suggestions'
