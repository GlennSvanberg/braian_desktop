import { createAnthropicChat } from '@tanstack/ai-anthropic'
import { createGeminiChat } from '@tanstack/ai-gemini'
import { createOpenaiChat } from '@tanstack/ai-openai'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'

import type { AiProviderId } from '@/lib/ai/model-catalog'
import { isTauri } from '@/lib/tauri-env'

/** Tauri’s WebView is still a browser context; official SDKs block unless opted in. */
export const desktopBrowserSdkOpts = {
  dangerouslyAllowBrowser: true as const,
}

export function resolveFetch(): typeof fetch {
  if (isTauri()) {
    return tauriFetch as unknown as typeof fetch
  }
  return globalThis.fetch.bind(globalThis)
}

export function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '')
}

export function buildChatAdapter(
  provider: AiProviderId,
  model: string,
  apiKey: string,
  baseUrl: string | null,
  fetchImpl: typeof fetch,
) {
  switch (provider) {
    case 'openai':
      return createOpenaiChat(model as never, apiKey, {
        fetch: fetchImpl,
        ...desktopBrowserSdkOpts,
      })
    case 'anthropic':
      return createAnthropicChat(model as never, apiKey, {
        fetch: fetchImpl,
        ...desktopBrowserSdkOpts,
      })
    case 'gemini':
      return createGeminiChat(model as never, apiKey, { fetch: fetchImpl })
    case 'openai_compatible': {
      const url = baseUrl?.trim()
      if (!url) {
        throw new Error('Base URL is required for OpenAI-compatible providers.')
      }
      return createOpenaiChat(model as never, apiKey, {
        baseURL: normalizeBaseUrl(url),
        fetch: fetchImpl,
        ...desktopBrowserSdkOpts,
      })
    }
    default:
      throw new Error(`Unknown provider: ${provider}`)
  }
}
