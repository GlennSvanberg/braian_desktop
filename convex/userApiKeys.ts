import { v } from 'convex/values'

import { internal } from './_generated/api'
import type { Doc } from './_generated/dataModel'
import { action, internalMutation, mutation, query } from './_generated/server'
import { requireUserId } from './lib/auth'
import { encryptSecret, lastFourOf } from './lib/crypto'

const PROVIDER_VALIDATOR = v.union(
  v.literal('openai'),
  v.literal('anthropic'),
  v.literal('gemini'),
)

export type ProviderId = 'openai' | 'anthropic' | 'gemini'

/**
 * Save an API key for the current user + provider.
 *
 * Encryption uses random IVs, which makes this an action (non-deterministic).
 * The actual write is delegated to an internal mutation so the row insert
 * stays atomic with the upsert.
 */
export const setApiKey = action({
  args: {
    provider: PROVIDER_VALIDATOR,
    apiKey: v.string(),
  },
  handler: async (ctx, args) => {
    const trimmed = args.apiKey.trim()
    if (!trimmed) throw new Error('API key cannot be empty.')
    const { cipherText, iv } = await encryptSecret(trimmed)
    await ctx.runMutation(internal.userApiKeys._upsertRow, {
      provider: args.provider,
      cipherText,
      iv,
      lastFour: lastFourOf(trimmed),
      updatedAtMs: Date.now(),
    })
    return { ok: true as const }
  },
})

export const _upsertRow = internalMutation({
  args: {
    provider: PROVIDER_VALIDATOR,
    cipherText: v.string(),
    iv: v.string(),
    lastFour: v.string(),
    updatedAtMs: v.number(),
  },
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx)
    const existing = await ctx.db
      .query('userApiKeys')
      .withIndex('byOwnerAndProvider', (q) =>
        q.eq('ownerId', ownerId).eq('provider', args.provider),
      )
      .unique()
    const patch: Partial<Doc<'userApiKeys'>> = {
      cipherText: args.cipherText,
      iv: args.iv,
      lastFour: args.lastFour,
      updatedAtMs: args.updatedAtMs,
    }
    if (existing) {
      await ctx.db.patch(existing._id, patch)
    } else {
      await ctx.db.insert('userApiKeys', {
        ownerId,
        provider: args.provider,
        cipherText: args.cipherText,
        iv: args.iv,
        lastFour: args.lastFour,
        updatedAtMs: args.updatedAtMs,
      })
    }
  },
})

export const clearApiKey = mutation({
  args: { provider: PROVIDER_VALIDATOR },
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx)
    const existing = await ctx.db
      .query('userApiKeys')
      .withIndex('byOwnerAndProvider', (q) =>
        q.eq('ownerId', ownerId).eq('provider', args.provider),
      )
      .unique()
    if (existing) await ctx.db.delete(existing._id)
    return { cleared: !!existing }
  },
})

/**
 * UI-friendly status of which provider keys the current user has stored.
 *
 * NEVER returns the raw key or ciphertext. Callers can use `lastFour` to
 * confirm-which-key-is-saved without exposing the secret.
 */
export const myApiKeyStatuses = query({
  args: {},
  handler: async (ctx) => {
    const ownerId = await requireUserId(ctx)
    const rows = await ctx.db
      .query('userApiKeys')
      .withIndex('byOwnerAndProvider', (q) => q.eq('ownerId', ownerId))
      .collect()
    return rows.map((row) => ({
      provider: row.provider,
      lastFour: row.lastFour,
      updatedAtMs: row.updatedAtMs,
    }))
  },
})
