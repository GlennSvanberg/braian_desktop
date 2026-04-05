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

export function resolveFetch(provider?: AiProviderId): typeof fetch {
  // Anthropic's API explicitly blocks CORS from browsers.
  // We must use Tauri's native HTTP client to bypass CORS for Anthropic.
  // For other providers (OpenAI, Gemini, most local servers), they support CORS,
  // so we prefer the browser's native fetch which has better streaming support
  // and avoids IPC buffering issues.
  if (isTauri() && provider === 'anthropic') {
    return async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      // Disable compression to prevent reqwest from buffering the SSE stream
      // during transparent decompression, which causes the "1-2 tokens then nothing" issue.
      headers.set('Accept-Encoding', 'identity')
      
      return tauriFetch(input, {
        ...init,
        headers,
      })
    }
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
