import type { ReasoningMode } from '@/lib/ai/types'
import type { AiProviderId } from '@/lib/ai/model-catalog'

/** Provider-specific options for TanStack `chat({ modelOptions })`. */
export type ReasoningModelOptions = Record<string, unknown>

function openAiSupportsReasoningEffortNone(modelId: string): boolean {
  return /^gpt-5(\.|$)/i.test(modelId.trim())
}

function anthropicModelUsesAdaptiveThinking(modelId: string): boolean {
  return /opus-4-6/i.test(modelId.trim())
}

/**
 * Maps Fast vs Thinking to native reasoning controls.
 * Returns `undefined` to let the provider use its default (avoids 400s on unsupported combos).
 */
export function buildReasoningModelOptions(
  provider: AiProviderId,
  modelId: string,
  mode: ReasoningMode,
): ReasoningModelOptions | undefined {
  const mid = modelId.trim()

  switch (provider) {
    case 'openai':
    case 'openai_compatible': {
      if (mode === 'fast') {
        if (!openAiSupportsReasoningEffortNone(mid)) return undefined
        return { reasoning: { effort: 'none' as const } }
      }
      return { reasoning: { effort: 'medium' as const } }
    }
    case 'anthropic': {
      if (mode === 'fast') {
        return { thinking: { type: 'disabled' as const } }
      }
      if (anthropicModelUsesAdaptiveThinking(mid)) {
        return {
          thinking: { type: 'adaptive' as const },
          effort: 'high' as const,
        }
      }
      return {
        thinking: {
          type: 'enabled' as const,
          budget_tokens: 10_000,
        },
      }
    }
    case 'gemini': {
      if (mode === 'fast') {
        // Omit config so models without thinking do not 400 on `thinkingConfig`.
        return undefined
      }
      return {
        thinkingConfig: {
          includeThoughts: true,
          thinkingBudget: 8192,
        },
      }
    }
    default:
      return undefined
  }
}
