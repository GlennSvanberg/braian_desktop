import { ConvexAuthProvider } from '@convex-dev/auth/react'
import { type ReactNode } from 'react'

import { CloudAuthBridge } from '@/lib/cloud/auth-state'
import { getConvexClient } from '@/lib/cloud/convex-client'

/**
 * Conditional Convex auth provider.
 *
 * - When `VITE_CONVEX_URL` is unset, this is a pass-through. No Convex client
 *   is constructed and no network calls happen. The desktop app keeps
 *   working exactly like it did before cloud sync existed.
 * - When the URL is set, we mount `ConvexAuthProvider` so any descendant can
 *   call `useAuthActions()`, `useConvexAuth()`, `useQuery(...)`, etc.
 *
 * We intentionally do not gate this on "signed in" - the provider must wrap
 * the tree so the auth state can flip at runtime when the user signs in.
 */
export function CloudAuthProvider({ children }: { children: ReactNode }) {
  const client = getConvexClient()
  if (!client) return <>{children}</>
  return (
    <ConvexAuthProvider client={client}>
      <CloudAuthBridge />
      {children}
    </ConvexAuthProvider>
  )
}
