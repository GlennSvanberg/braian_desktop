import { Password } from '@convex-dev/auth/providers/Password'
import { convexAuth } from '@convex-dev/auth/server'

/**
 * Convex Auth wired up with the simple email + password provider.
 *
 * Notes:
 * - We deliberately do NOT enable email verification or password reset in V1
 *   to keep the dependency surface minimal (no Resend, no extra env vars).
 * - The browser/web client never calls these functions directly; instead it
 *   uses `useAuthActions().signIn('password', { email, password, flow })`
 *   from `@convex-dev/auth/react`.
 */
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Password],
})
