import { ConvexReactClient } from 'convex/react'

/**
 * Lazy `ConvexReactClient` singleton.
 *
 * Returns `null` when `VITE_CONVEX_URL` isn't set so the app can boot offline
 * (signed-out desktop, browser dev preview, anyone without their own Convex
 * deployment). The whole cloud layer is built around this returning `null`
 * being a fully supported state - no provider mounts, no traffic, no UI.
 */
let cachedClient: ConvexReactClient | null | undefined = undefined

export function getConvexUrl(): string | null {
  const url = (import.meta.env.VITE_CONVEX_URL as string | undefined)?.trim()
  return url && url.length > 0 ? url : null
}

/**
 * Convex deployment "site URL" for HTTP actions (e.g. the chat proxy).
 *
 * Falls back to the `convex.cloud` URL with a `.site` host swap if the
 * dedicated env var isn't set, matching how `npx convex dev` writes both
 * variables out to `.env.local`.
 */
export function getConvexSiteUrl(): string | null {
  const explicit = (
    import.meta.env.VITE_CONVEX_SITE_URL as string | undefined
  )?.trim()
  if (explicit) return explicit.replace(/\/+$/, '')
  const url = getConvexUrl()
  if (!url) return null
  // Convex maps `<deployment>.convex.cloud` → `<deployment>.convex.site`.
  return url.replace(/\.convex\.cloud(\/?$)/, '.convex.site').replace(/\/+$/, '')
}

export function getConvexClient(): ConvexReactClient | null {
  if (cachedClient !== undefined) return cachedClient
  const url = getConvexUrl()
  if (!url) {
    cachedClient = null
    return cachedClient
  }
  try {
    cachedClient = new ConvexReactClient(url)
  } catch (err) {
    console.error('[braian/cloud] Failed to construct Convex client', err)
    cachedClient = null
  }
  return cachedClient
}

/** True iff a Convex deployment URL is configured. */
export function isCloudConfigured(): boolean {
  return getConvexClient() !== null
}
