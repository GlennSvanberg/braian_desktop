import { getAuthUserId } from '@convex-dev/auth/server'
import type { Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'

/**
 * Resolve the authenticated Convex Auth user id or throw.
 *
 * Convex Auth populates the `users` table for us via `authTables` and exposes
 * the current user's id through `getAuthUserId(ctx)`. We don't need a custom
 * `users` table or a `tokenIdentifier` mapping in V1.
 */
export async function requireUserId(
  ctx: QueryCtx | MutationCtx,
): Promise<Id<'users'>> {
  const userId = await getAuthUserId(ctx)
  if (!userId) {
    throw new Error('Not authenticated')
  }
  return userId
}

export async function getUserIdOrNull(
  ctx: QueryCtx | MutationCtx,
): Promise<Id<'users'> | null> {
  return getAuthUserId(ctx)
}
