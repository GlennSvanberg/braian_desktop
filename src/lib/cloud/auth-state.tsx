import { useEffect } from 'react'
import { useAuthToken } from '@convex-dev/auth/react'
import { useConvexAuth } from 'convex/react'

import { isCloudConfigured } from './convex-client'

/**
 * Module-level mirror of `useConvexAuth()` so non-React code (the desktop
 * sync write path triggered from `conversationSave`) can quickly check
 * "should I push to the cloud right now?" without subscribing.
 */
let _isAuthenticated = false
let _isLoading = false
let _authToken: string | null = null
const listeners = new Set<() => void>()

function notify() {
  for (const fn of listeners) fn()
}

export function isCloudAuthenticated(): boolean {
  return isCloudConfigured() && _isAuthenticated
}

export function isCloudAuthLoading(): boolean {
  return isCloudConfigured() && _isLoading
}

/** Same condition the rest of the sync layer uses to gate any network work. */
export function isCloudEnabled(): boolean {
  return isCloudAuthenticated()
}

/**
 * Current Convex Auth JWT, used to authenticate plain `fetch` calls to
 * Convex HTTP actions (e.g. the chat provider proxy). Returns null until
 * the auth handshake completes or when sync is disabled.
 */
export function getCloudAuthToken(): string | null {
  return _authToken
}

export function subscribeCloudAuth(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/**
 * Mount once near the top of the tree (inside `CloudAuthProvider`) to keep
 * the module-level mirror in sync with the Convex Auth provider state.
 *
 * Safe to import from non-cloud-aware components: when the provider isn't
 * mounted (no `VITE_CONVEX_URL`) the underlying `useConvexAuth` hook would
 * throw, so we guard by checking `isCloudConfigured()` first and skipping
 * the hook call entirely.
 */
export function CloudAuthBridge() {
  if (!isCloudConfigured()) return null
  return <CloudAuthBridgeInner />
}

function CloudAuthBridgeInner() {
  const { isAuthenticated, isLoading } = useConvexAuth()
  const token = useAuthToken()
  useEffect(() => {
    const changed =
      _isAuthenticated !== isAuthenticated ||
      _isLoading !== isLoading ||
      _authToken !== token
    _isAuthenticated = isAuthenticated
    _isLoading = isLoading
    _authToken = token ?? null
    if (changed) notify()
  }, [isAuthenticated, isLoading, token])
  return null
}
