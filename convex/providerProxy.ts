import { getAuthUserId } from '@convex-dev/auth/server'
import { v } from 'convex/values'

import { internal } from './_generated/api'
import { httpAction, internalQuery } from './_generated/server'
import { decryptSecret } from './lib/crypto'

/**
 * Provider proxy: receives a chat request from a signed-in web client,
 * looks up the user's encrypted API key for the requested provider, and
 * forwards the request (with the decrypted key) to the upstream provider.
 *
 * This is intentionally **dumb**: we re-stream the upstream response body
 * back to the caller without parsing it. The TanStack AI adapter on the
 * client receives bytes that look exactly like a direct provider response.
 *
 * Browser CORS is handled by Convex's Cloud (HTTP actions support standard
 * `fetch` semantics; CORS headers below allow the web client to call us).
 */

type ProviderId = 'openai' | 'anthropic' | 'gemini'

type ProviderRoute = {
  /** Where the upstream API lives; the caller's path (after the prefix) is appended. */
  baseUrl: string
  /** Header that carries the API key. */
  headerName: string
  /** Optional value prefix (e.g. "Bearer "). */
  headerPrefix?: string
  /** Extra static headers required by the provider. */
  extraHeaders?: Record<string, string>
}

const PROVIDER_ROUTES: Record<ProviderId, ProviderRoute> = {
  openai: {
    baseUrl: 'https://api.openai.com',
    headerName: 'Authorization',
    headerPrefix: 'Bearer ',
  },
  anthropic: {
    baseUrl: 'https://api.anthropic.com',
    headerName: 'x-api-key',
    extraHeaders: {
      'anthropic-version': '2023-06-01',
      // The official SDK / our adapter sends this when running in browser; we
      // accept the same header from the upstream client and forward it.
    },
  },
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com',
    headerName: 'x-goog-api-key',
  },
}

const PROXY_PREFIX = '/provider-proxy/'

const ALLOW_HEADERS = [
  'authorization',
  'content-type',
  'accept',
  'anthropic-version',
  'anthropic-dangerous-direct-browser-access',
  'x-stainless-arch',
  'x-stainless-lang',
  'x-stainless-os',
  'x-stainless-package-version',
  'x-stainless-runtime',
  'x-stainless-runtime-version',
].join(', ')

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin ?? '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': ALLOW_HEADERS,
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

function isProviderId(s: string): s is ProviderId {
  return s === 'openai' || s === 'anthropic' || s === 'gemini'
}

function badRequest(message: string, origin: string | null): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 400,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  })
}

function unauthorized(message: string, origin: string | null): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  })
}

/**
 * Strip headers that would confuse the upstream (auth aimed at us, encoding
 * negotiation that may break SSE), and add the upstream-required headers.
 */
function rewriteRequestHeaders(
  incoming: Headers,
  route: ProviderRoute,
  decryptedKey: string,
): Headers {
  const out = new Headers()
  incoming.forEach((value, key) => {
    const k = key.toLowerCase()
    if (
      k === 'authorization' ||
      k === 'host' ||
      k === 'cookie' ||
      k === 'connection' ||
      k === 'content-length' ||
      k.startsWith('cf-') ||
      k.startsWith('x-forwarded-') ||
      k === 'x-real-ip'
    ) {
      return
    }
    out.set(key, value)
  })
  out.set(
    route.headerName,
    `${route.headerPrefix ?? ''}${decryptedKey}`,
  )
  if (route.extraHeaders) {
    for (const [k, v] of Object.entries(route.extraHeaders)) {
      if (!out.has(k)) out.set(k, v)
    }
  }
  out.set('Accept-Encoding', 'identity')
  return out
}

export const providerProxyHandler = httpAction(async (ctx, request) => {
  const origin = request.headers.get('Origin')
  const url = new URL(request.url)

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) })
  }

  if (!url.pathname.startsWith(PROXY_PREFIX)) {
    return badRequest('Unexpected proxy path.', origin)
  }
  const rest = url.pathname.slice(PROXY_PREFIX.length)
  const [providerSegment, ...pathSegments] = rest.split('/')
  if (!providerSegment || !isProviderId(providerSegment)) {
    return badRequest(
      `Unknown provider "${providerSegment}". Expected openai|anthropic|gemini.`,
      origin,
    )
  }
  const upstreamPath = '/' + pathSegments.join('/')

  const userId = await getAuthUserId(ctx)
  if (!userId) return unauthorized('Sign in to use the chat proxy.', origin)

  const stored = await ctx.runQuery(
    internal.providerProxy._getEncryptedKeyForProxy,
    { userId, provider: providerSegment },
  )
  if (!stored) {
    return new Response(
      JSON.stringify({
        error: `No ${providerSegment} API key on file. Set one in the Cloud sync card.`,
      }),
      {
        status: 412,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      },
    )
  }

  let decrypted: string
  try {
    decrypted = await decryptSecret({
      cipherText: stored.cipherText,
      iv: stored.iv,
    })
  } catch (err) {
    console.error('[braian/proxy] decrypt failed', err)
    return new Response(
      JSON.stringify({
        error:
          'Failed to decrypt stored API key. The encryption key may have changed; please re-enter it.',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      },
    )
  }

  const route = PROVIDER_ROUTES[providerSegment]
  const targetUrl = route.baseUrl + upstreamPath + url.search
  const upstreamHeaders = rewriteRequestHeaders(
    request.headers,
    route,
    decrypted,
  )

  const upstreamReq: RequestInit = {
    method: request.method,
    headers: upstreamHeaders,
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    upstreamReq.body = await request.arrayBuffer()
  }

  let upstream: Response
  try {
    upstream = await fetch(targetUrl, upstreamReq)
  } catch (err) {
    console.error('[braian/proxy] upstream fetch failed', err)
    return new Response(
      JSON.stringify({ error: 'Upstream request failed.' }),
      {
        status: 502,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      },
    )
  }

  // Mirror upstream headers but strip ones that would break browser semantics.
  const responseHeaders = new Headers()
  upstream.headers.forEach((value, key) => {
    const k = key.toLowerCase()
    if (
      k === 'content-encoding' ||
      k === 'transfer-encoding' ||
      k === 'connection' ||
      k === 'content-length'
    ) {
      return
    }
    responseHeaders.set(key, value)
  })
  for (const [k, v] of Object.entries(corsHeaders(origin))) {
    responseHeaders.set(k, v)
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  })
})

export const _getEncryptedKeyForProxy = internalQuery({
  args: {
    userId: v.id('users'),
    provider: v.union(
      v.literal('openai'),
      v.literal('anthropic'),
      v.literal('gemini'),
    ),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('userApiKeys')
      .withIndex('byOwnerAndProvider', (q) =>
        q.eq('ownerId', args.userId).eq('provider', args.provider),
      )
      .unique()
    if (!row) return null
    return { cipherText: row.cipherText, iv: row.iv }
  },
})
