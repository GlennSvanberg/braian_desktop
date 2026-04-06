import type { Tool } from '@tanstack/ai'
import { GEMINI_MODELS } from '@tanstack/ai-gemini'

import type { AiProviderId } from '@/lib/ai/model-catalog'

const GEMINI_MODEL_IDS = new Set<string>(GEMINI_MODELS)

/** Matches `webSearchTool({ type: 'web_search' })` from `@tanstack/ai-openai` (not re-exported from package root). */
function openAiNativeWebSearchTool(): Tool {
  return {
    name: 'web_search',
    description: 'Search the web',
    metadata: { type: 'web_search' as const },
  }
}

/** Matches `webSearchTool({ name, type })` from `@tanstack/ai-anthropic` (not re-exported from package root). */
function anthropicNativeWebSearchTool(): Tool {
  return {
    name: 'web_search',
    description: '',
    metadata: {},
  }
}

/** Matches `googleSearchTool()` from `@tanstack/ai-gemini` (not re-exported from package root). */
function geminiNativeGoogleSearchTool(): Tool {
  return {
    name: 'google_search',
    description: '',
    metadata: {},
  }
}

/**
 * OpenAI Responses `web_search` is omitted for model ids that match TanStack/OpenAI
 * patterns where hosted tools are not advertised (e.g. `*-chat-latest`).
 */
export function shouldIncludeOpenAiWebSearch(modelId: string): boolean {
  const id = modelId.trim()
  if (!id) return false
  if (/-chat-latest$/i.test(id)) return false
  if (/^gpt-4o.*-audio/i.test(id) || /^gpt-audio/i.test(id)) return false
  if (id === 'computer-use-preview') return false
  return true
}

export function shouldIncludeAnthropicWebSearch(modelId: string): boolean {
  const id = modelId.trim()
  if (!id) return false
  return id.startsWith('claude-')
}

export function shouldIncludeGeminiGoogleSearch(modelId: string): boolean {
  const id = modelId.trim()
  if (!id) return false
  if (GEMINI_MODEL_IDS.has(id)) return true
  if (id.startsWith('gemini-2.') || id.startsWith('gemini-3.')) return true
  return false
}

export type BuildProviderNativeSearchToolsOptions = {
  provider: AiProviderId
  modelId: string
}

/**
 * At most one tool: vendor-hosted web search (executed by the provider, not Braian).
 */
export function buildProviderNativeSearchTools(
  options: BuildProviderNativeSearchToolsOptions,
): Tool[] {
  const { provider, modelId } = options
  switch (provider) {
    case 'openai': {
      if (!shouldIncludeOpenAiWebSearch(modelId)) return []
      return [openAiNativeWebSearchTool()]
    }
    case 'openai_compatible':
      return []
    case 'anthropic': {
      if (!shouldIncludeAnthropicWebSearch(modelId)) return []
      return [anthropicNativeWebSearchTool()]
    }
    case 'gemini': {
      if (!shouldIncludeGeminiGoogleSearch(modelId)) return []
      return [geminiNativeGoogleSearchTool()]
    }
    default:
      return []
  }
}
