import type { AiProviderId } from '@/lib/ai/model-catalog'

import { getCloudAuthToken } from './auth-state'
import { getConvexSiteUrl } from './convex-client'

/**
 * Build a `fetch` implementation that intercepts calls aimed at OpenAI /
 * Anthropic / Gemini and reroutes them through the Convex
 * `/provider-proxy/<provider>/...` HTTP action with the current user's
 * Convex Auth bearer token attached.
 *
 * Why a fetch shim and not a brand-new chat adapter:
 *   The TanStack AI provider adapters (`@tanstack/ai-openai` etc.) already
 *   speak each provider's exact wire format. Replacing only the transport
 *   means the cloud path benefits from any upstream adapter fixes for free.
 *
 * Limitations:
 *   - Only the proxied providers are rewritten; calls to anything else
 *     fall through to the platform `fetch`.
 *   - The proxy enforces auth + presence of a stored API key; the actual
 *     key string is never sent from the browser.
 */

const PROVIDER_HOSTS: Record<AiProviderId, string | null> = {
  openai: 'api.openai.com',
  anthropic: 'api.anthropic.com',
  gemini: 'generativelanguage.googleapis.com',
  // Custom OpenAI-compatible endpoints (Ollama, etc.) point at the user's
  // own infra and aren't routable through the cloud proxy.
  openai_compatible: null,
}

const PROVIDER_PATH_SEGMENT: Record<
  Exclude<AiProviderId, 'openai_compatible'>,
  string
> = {
  openai: 'openai',
  anthropic: 'anthropic',
  gemini: 'gemini',
}

function rewriteUrl(provider: AiProviderId, originalUrl: string): string | null {
  if (provider === 'openai_compatible') return null
  const expectedHost = PROVIDER_HOSTS[provider]
  if (!expectedHost) return null
  const siteUrl = getConvexSiteUrl()
  if (!siteUrl) return null
  let parsed: URL
  try {
    parsed = new URL(originalUrl)
  } catch {
    return null
  }
  if (parsed.host !== expectedHost) return null
  const segment = PROVIDER_PATH_SEGMENT[provider]
  // Gemini's SDK can pass the API key as `?key=...` in addition to (or
  // instead of) the header. Strip it so the placeholder never reaches the
  // proxy log, then let the proxy inject the real key from the user's row.
  parsed.searchParams.delete('key')
  return `${siteUrl}/provider-proxy/${segment}${parsed.pathname}${parsed.search}`
}

export function buildCloudProxyFetch(provider: AiProviderId): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const inputUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url
    const rewritten = rewriteUrl(provider, inputUrl)
    if (!rewritten) {
      return globalThis.fetch(input, init)
    }
    const token = getCloudAuthToken()
    if (!token) {
      throw new Error(
        'Sign in (Cloud sync card) before chatting from the web client.',
      )
    }
    const headers = new Headers(init?.headers)
    // The provider proxy injects the real key; strip whatever the SDK sent.
    headers.delete('authorization')
    headers.delete('x-api-key')
    headers.delete('x-goog-api-key')
    // Auth ourselves to Convex.
    headers.set('Authorization', `Bearer ${token}`)
    return globalThis.fetch(rewritten, { ...init, headers })
  }
}
