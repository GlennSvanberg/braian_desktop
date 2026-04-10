/**
 * Token estimates for context budgeting and diagnostics.
 *
 * Uses `gpt-tokenizer` (OpenAI o200k / GPT-4o-class BPE). For Anthropic and Gemini
 * we use the same encoding as a **predictable approximation** — counts are not
 * identical to each provider’s tokenizer but are stable for trimming heuristics.
 */
import { countTokens } from 'gpt-tokenizer'

import type { AiProviderId } from '@/lib/ai/model-catalog'

export type TokenEstimateOptions = {
  provider: AiProviderId
  modelId: string
}

/**
 * Estimate token count for arbitrary text (system sections, history lines, etc.).
 */
export function estimateTextTokens(
  text: string,
  _options: TokenEstimateOptions,
): number {
  if (!text) return 0
  void _options
  return countTokens(text)
}

/**
 * Sum of per-message tokens for chat history (user + assistant strings as sent to the LLM).
 */
export function estimateChatHistoryTokens(
  messages: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>,
  options: TokenEstimateOptions,
): number {
  let n = 0
  for (const m of messages) {
    n += estimateTextTokens(`${m.role}\n${m.content}`, options)
  }
  return n
}
