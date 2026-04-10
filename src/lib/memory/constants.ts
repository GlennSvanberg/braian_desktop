/** Workspace-relative path to durable memory markdown. */
export const MEMORY_RELATIVE_PATH = '.braian/MEMORY.md'

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

/** Workspace-relative JSON: last-reviewed message ids per conversation. */
export const MEMORY_REVIEW_STATE_RELATIVE_PATH = '.braian/memory-review-state.json'

/** Max bytes read from MEMORY.md when injecting into chat context. */
export const MEMORY_INJECT_MAX_BYTES = 24 * 1024

/** Max bytes when loading MEMORY.md for the review model (full file for merge). */
export const MEMORY_REVIEW_READ_MAX_BYTES = 512 * 1024

/** Idle debounce before running auto memory review (ms). */
export const MEMORY_REVIEW_DEBOUNCE_MS = 3 * 60 * 1000

/** Minimum time between successful auto reviews per workspace (ms). */
export const MEMORY_REVIEW_MIN_INTERVAL_MS = 20 * 60 * 1000

/** Max chat messages to include in review transcript (from end). */
export const MEMORY_REVIEW_MAX_MESSAGES = 40
