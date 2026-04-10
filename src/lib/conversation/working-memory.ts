import { z } from 'zod'

import { completeChatText } from '@/lib/ai/complete-text'
import type { AiProviderId } from '@/lib/ai/model-catalog'
import { isMockAiMode } from '@/lib/ai/mock-mode'
import {
  estimateChatHistoryTokens,
  estimateTextTokens,
  type TokenEstimateOptions,
} from '@/lib/ai/token-estimate'
import { aiSettingsGet, type AiSettingsDto } from '@/lib/ai-settings-api'
import type {
  ConversationWorkingMemoryContext,
  PriorChatMessage,
} from '@/lib/ai/types'
import { chatMessageContentForLlmHistory } from '@/lib/chat-sessions/chat-message-llm-history'
import type { ChatMessage } from '@/lib/chat-sessions/types'
import {
  conversationSummaryRelativePath,
  conversationTranscriptRelativePath,
} from '@/lib/memory/constants'
import { formatMessagesForMemoryReview } from '@/lib/memory/format-transcript'
import {
  isNonWorkspaceScopedSessionId,
  isUserProfileSessionId,
} from '@/lib/chat-sessions/detached'
import { isTauri } from '@/lib/tauri-env'
import { workspaceReadTextFile, workspaceWriteTextFile } from '@/lib/workspace-api'

const summaryFileSchemaV1 = z.object({
  schemaVersion: z.literal(1),
  conversationId: z.string(),
  updatedAt: z.string(),
  summary: z.string(),
  openLoops: z.array(z.string()),
  coveredMessageIds: z.array(z.string()),
})

export type ConversationSummaryFileV1 = z.infer<typeof summaryFileSchemaV1>

const COMPACTION_SYSTEM = `You compress older chat turns into a durable rolling summary for the coding assistant.

Output **only** a single JSON object (no markdown fences, no commentary) with this exact shape:
{
  "summary": "string — merged narrative of older work; merge with previous summary when provided",
  "openLoops": ["string", "..."],
  "coveredMessageIds": ["message-id", "..."]
}

Rules:
- "summary" must incorporate the previous summary (if any) and the new transcript slice; no duplication.
- "openLoops" lists unresolved questions or tasks still relevant (short bullets as strings).
- "coveredMessageIds" must list **every** message id from the transcript slice you folded in (all ids shown in the transcript section).
- Do not invent facts; omit transient tool noise when possible.
- Keep "summary" compact but actionable.`

function parseJsonObject(raw: string): unknown {
  let t = raw.trim()
  const fence = /^```(?:json)?\s*\n([\s\S]*?)\n```/m.exec(t)
  if (fence) t = fence[1].trim()
  return JSON.parse(t) as unknown
}

const queueTail = new Map<string, Promise<unknown>>()

export function withWorkingMemoryCompactionMutex<T>(
  workspaceId: string,
  conversationFileId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const key = `${workspaceId}::${conversationFileId}`
  const prev = queueTail.get(key) ?? Promise.resolve()
  const result = prev.then(() => fn())
  queueTail.set(
    key,
    result.then(
      () => undefined,
      () => undefined,
    ),
  )
  return result
}

function tokenOpts(
  provider: AiProviderId,
  modelId: string,
): TokenEstimateOptions {
  return { provider, modelId }
}

function messageTokens(m: ChatMessage, opts: TokenEstimateOptions): number {
  const content = chatMessageContentForLlmHistory(m)
  return estimateTextTokens(`${m.role}\n${content}`, opts)
}

/**
 * Keep as many **recent** messages as fit under the token budget.
 * If the newest message alone exceeds the budget, keep a **suffix** of its text.
 */
export function takeSuffixWithinTokenBudget(
  messages: ChatMessage[],
  budget: number,
  opts: TokenEstimateOptions,
): {
  suffix: ChatMessage[]
  prefix: ChatMessage[]
  hadToTruncateMessage: boolean
} {
  if (budget < 1 || messages.length === 0) {
    return { suffix: [], prefix: [...messages], hadToTruncateMessage: false }
  }

  const costs = messages.map((m) => messageTokens(m, opts))
  let total = costs.reduce((a, b) => a + b, 0)
  if (total <= budget) {
    return { suffix: [...messages], prefix: [], hadToTruncateMessage: false }
  }

  const suffix: ChatMessage[] = []
  let used = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    const c = costs[i]
    if (used + c <= budget) {
      suffix.unshift(m)
      used += c
      continue
    }
    if (suffix.length > 0) break
    const content = chatMessageContentForLlmHistory(m)
    const role = m.role
    let low = 0
    let high = content.length
    let bestLen = 0
    while (low <= high) {
      const mid = Math.floor((low + high) / 2)
      const slice = content.slice(content.length - mid)
      const t = estimateTextTokens(`${role}\n${slice}`, opts)
      if (t <= budget) {
        bestLen = mid
        low = mid + 1
      } else {
        high = mid - 1
      }
    }
    if (bestLen < 1) {
      return {
        suffix: [],
        prefix: [...messages],
        hadToTruncateMessage: true,
      }
    }
    const truncated =
      role === 'user'
        ? ({
            id: m.id,
            role: 'user' as const,
            content:
              '[Earlier text omitted for context budget.]\n' +
              content.slice(content.length - bestLen),
            createdAtMs: m.createdAtMs,
          } as ChatMessage)
        : ({
            id: m.id,
            role: 'assistant' as const,
            content:
              '[Earlier text omitted for context budget.]\n' +
              content.slice(content.length - bestLen),
            createdAtMs: m.createdAtMs,
            ...(m.parts ? { parts: m.parts } : {}),
          } as ChatMessage)
    suffix.unshift(truncated)
    const prefix = messages.slice(0, i)
    return { suffix, prefix, hadToTruncateMessage: true }
  }

  const prefix = messages.slice(0, messages.length - suffix.length)
  return { suffix, prefix, hadToTruncateMessage: false }
}

function toPriorMessages(messages: ChatMessage[]): PriorChatMessage[] {
  return messages.map((m) => ({
    role: m.role,
    content: chatMessageContentForLlmHistory(m),
  }))
}

async function loadSummaryFile(
  workspaceId: string,
  conversationFileId: string,
): Promise<ConversationSummaryFileV1 | null> {
  const rel = conversationSummaryRelativePath(conversationFileId)
  try {
    const { text } = await workspaceReadTextFile(workspaceId, rel, 512 * 1024)
    const parsed = parseJsonObject(text)
    const r = summaryFileSchemaV1.safeParse(parsed)
    if (!r.success || r.data.conversationId !== conversationFileId) return null
    return r.data
  } catch {
    return null
  }
}

async function saveSummaryFile(
  workspaceId: string,
  data: ConversationSummaryFileV1,
): Promise<void> {
  const rel = conversationSummaryRelativePath(data.conversationId)
  await workspaceWriteTextFile(workspaceId, rel, `${JSON.stringify(data, null, 2)}\n`)
}

async function runCompactionLlm(options: {
  previousSummary: string
  transcriptSlice: string
  expectedMessageIds: string[]
  signal?: AbortSignal
}): Promise<Pick<ConversationSummaryFileV1, 'summary' | 'openLoops' | 'coveredMessageIds'>> {
  const userMessage = [
    '## Previous summary (may be empty)',
    options.previousSummary.trim() || '(none)',
    '',
    '## Transcript slice to fold in',
    `Message ids in this slice: ${options.expectedMessageIds.join(', ')}`,
    '',
    options.transcriptSlice,
  ].join('\n')

  const raw = await completeChatText({
    systemPrompts: [COMPACTION_SYSTEM],
    userMessage,
    signal: options.signal,
  })

  const parsed = parseJsonObject(raw)
  const out = z
    .object({
      summary: z.string(),
      openLoops: z.array(z.string()),
      coveredMessageIds: z.array(z.string()),
    })
    .safeParse(parsed)
  if (!out.success) {
    throw new Error('Compaction model returned invalid JSON.')
  }
  return out.data
}

export type PrepareHistoryOptions = {
  workspaceId: string
  /** Use `conversationId ?? 'draft'` for file paths when saving summaries. */
  conversationFileId: string
  prevMessages: ChatMessage[]
  provider: AiProviderId
  modelId: string
  maxHistoryTokens: number
  signal?: AbortSignal
  /** Persist summary files and run LLM compaction (desktop workspace chats). */
  persistCompaction: boolean
}

export type PrepareHistoryResult = {
  priorMessages: PriorChatMessage[]
  workingMemory: ConversationWorkingMemoryContext | null
}

/**
 * Shared path for chat UI and context preview: token-trim + optional compaction.
 * Returns AI settings from the same load used for budgeting (pass through to `buildTanStackChatTurnArgs`).
 */
export async function resolveChatHistoryForModelTurn(options: {
  workspaceId: string
  conversationId: string | null
  prevMessages: ChatMessage[]
  signal?: AbortSignal
}): Promise<PrepareHistoryResult & { settings: AiSettingsDto }> {
  const settings = await aiSettingsGet()
  const { workspaceId, conversationId, prevMessages, signal } = options

  if (
    isUserProfileSessionId(workspaceId) ||
    isNonWorkspaceScopedSessionId(workspaceId)
  ) {
    const tok = {
      provider: settings.provider,
      modelId: settings.modelId,
    }
    const { suffix } = takeSuffixWithinTokenBudget(
      prevMessages,
      settings.contextMaxHistoryTokens,
      tok,
    )
    return {
      priorMessages: toPriorMessages(suffix),
      workingMemory: null,
      settings,
    }
  }

  const r = await prepareConversationHistoryForModel({
    workspaceId,
    conversationFileId: conversationId ?? 'draft',
    prevMessages,
    provider: settings.provider,
    modelId: settings.modelId,
    maxHistoryTokens: settings.contextMaxHistoryTokens,
    signal,
    persistCompaction:
      isTauri() &&
      !isNonWorkspaceScopedSessionId(workspaceId) &&
      !isUserProfileSessionId(workspaceId),
  })
  return { ...r, settings }
}

export async function prepareConversationHistoryForModel(
  opts: PrepareHistoryOptions,
): Promise<PrepareHistoryResult> {
  const {
    workspaceId,
    conversationFileId,
    prevMessages,
    provider,
    modelId,
    maxHistoryTokens,
    signal,
    persistCompaction,
  } = opts

  const tok = tokenOpts(provider, modelId)
  const archivePath = conversationTranscriptRelativePath(conversationFileId)

  if (!persistCompaction) {
    const { suffix, prefix, hadToTruncateMessage } = takeSuffixWithinTokenBudget(
      prevMessages,
      maxHistoryTokens,
      tok,
    )
    let note: string | undefined
    if (prefix.length > 0 || hadToTruncateMessage) {
      note =
        'Older turns were omitted from the model request due to the chat history token budget.'
    }
    return {
      priorMessages: toPriorMessages(suffix),
      workingMemory: {
        summaryText: '',
        openLoops: [],
        fullTranscriptRelativePath: archivePath,
        compactionWarning: note,
      },
    }
  }

  return withWorkingMemoryCompactionMutex(
    workspaceId,
    conversationFileId,
    async () => {
      let state = await loadSummaryFile(workspaceId, conversationFileId)
      if (!state) {
        state = {
          schemaVersion: 1,
          conversationId: conversationFileId,
          updatedAt: new Date().toISOString(),
          summary: '',
          openLoops: [],
          coveredMessageIds: [],
        }
      }

      const priorAsRows = prevMessages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: chatMessageContentForLlmHistory(m),
      }))
      const totalTok = estimateChatHistoryTokens(priorAsRows, tok)

      if (totalTok <= maxHistoryTokens) {
        return {
          priorMessages: toPriorMessages(prevMessages),
          workingMemory: {
            summaryText: state.summary.trim(),
            openLoops: state.openLoops,
            fullTranscriptRelativePath: archivePath,
          },
        }
      }

      const { suffix, prefix, hadToTruncateMessage } =
        takeSuffixWithinTokenBudget(prevMessages, maxHistoryTokens, tok)

      if (prefix.length === 0) {
        return {
          priorMessages: toPriorMessages(suffix),
          workingMemory: {
            summaryText: state.summary.trim(),
            openLoops: state.openLoops,
            fullTranscriptRelativePath: archivePath,
            compactionWarning: hadToTruncateMessage
              ? 'At least one message was truncated to satisfy the history token budget.'
              : undefined,
          },
        }
      }

      const covered = new Set(state.coveredMessageIds)
      const allPrefixCovered = prefix.every((m) => covered.has(m.id))

      let summaryText = state.summary
      let openLoops = state.openLoops
      let coveredMessageIds = state.coveredMessageIds

      if (!allPrefixCovered) {
        const canLlm = isTauri() && !isMockAiMode()
        const prefixIds = prefix.map((m) => m.id)
        const transcriptSlice = formatMessagesForMemoryReview(prefix)

        if (canLlm) {
          try {
            const merged = await runCompactionLlm({
              previousSummary: state.summary,
              transcriptSlice,
              expectedMessageIds: prefixIds,
              signal,
            })
            summaryText = merged.summary
            openLoops = merged.openLoops
            coveredMessageIds = prefixIds
            const next: ConversationSummaryFileV1 = {
              schemaVersion: 1,
              conversationId: conversationFileId,
              updatedAt: new Date().toISOString(),
              summary: summaryText,
              openLoops,
              coveredMessageIds,
            }
            await saveSummaryFile(workspaceId, next)
          } catch {
            summaryText =
              state.summary +
              (state.summary ? '\n\n' : '') +
              '[Compaction failed; older turns were dropped without a full summary merge.]'
            coveredMessageIds = prefixIds
            const next: ConversationSummaryFileV1 = {
              schemaVersion: 1,
              conversationId: conversationFileId,
              updatedAt: new Date().toISOString(),
              summary: summaryText,
              openLoops: state.openLoops,
              coveredMessageIds,
            }
            try {
              await saveSummaryFile(workspaceId, next)
            } catch {
              /* ignore */
            }
          }
        } else {
          summaryText =
            state.summary +
            (state.summary ? '\n\n' : '') +
            '[Compaction skipped (mock or non-desktop); older turns omitted.]'
          coveredMessageIds = prefixIds
          const next: ConversationSummaryFileV1 = {
            schemaVersion: 1,
            conversationId: conversationFileId,
            updatedAt: new Date().toISOString(),
            summary: summaryText,
            openLoops: state.openLoops,
            coveredMessageIds,
          }
          try {
            await saveSummaryFile(workspaceId, next)
          } catch {
            /* ignore */
          }
        }
      }

      return {
        priorMessages: toPriorMessages(suffix),
        workingMemory: {
          summaryText: summaryText.trim(),
          openLoops,
          fullTranscriptRelativePath: archivePath,
          compactionWarning: hadToTruncateMessage
            ? 'At least one message was truncated to satisfy the history token budget.'
            : undefined,
        },
      }
    },
  )
}
