import { v } from 'convex/values'

import type { Doc } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'
import { mutation, query } from './_generated/server'
import { requireUserId } from './lib/auth'

/**
 * Cloud-side conversation + message API used by the desktop sync layer.
 *
 * Conventions (V1):
 * - Scalar conversation fields are LWW by `updatedAtMs`. The client always
 *   stamps `updatedAtMs = Date.now()` when it pushes; the server only writes
 *   if the new value is strictly greater than the stored one.
 * - Messages are append-only and idempotent on `clientMsgId`. Re-pushing the
 *   same message (e.g. retry after offline) is a no-op.
 * - All access is owner-scoped via `requireUserId(ctx)`.
 */

const messageInputValidator = v.object({
  clientMsgId: v.string(),
  role: v.union(v.literal('user'), v.literal('assistant')),
  content: v.string(),
  status: v.optional(v.string()),
  createdAtMs: v.optional(v.number()),
})

async function findConversation(
  ctx: QueryCtx | MutationCtx,
  ownerId: Doc<'users'>['_id'],
  clientId: string,
): Promise<Doc<'conversations'> | null> {
  return ctx.db
    .query('conversations')
    .withIndex('byOwnerAndClient', (q) =>
      q.eq('ownerId', ownerId).eq('clientId', clientId),
    )
    .unique()
}

async function nextOrderKey(
  ctx: MutationCtx,
  ownerId: Doc<'users'>['_id'],
  conversationClientId: string,
): Promise<number> {
  const last = await ctx.db
    .query('messages')
    .withIndex('byOwnerConvAndOrder', (q) =>
      q
        .eq('ownerId', ownerId)
        .eq('conversationClientId', conversationClientId),
    )
    .order('desc')
    .first()
  return (last?.orderKey ?? 0) + 1
}

/**
 * List the current user's conversations, newest activity first.
 *
 * Soft-deleted rows are filtered out at the query layer so the client doesn't
 * have to know about `deletedAtMs`.
 */
export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const ownerId = await requireUserId(ctx)
    const rows = await ctx.db
      .query('conversations')
      .withIndex('byOwnerAndUpdated', (q) => q.eq('ownerId', ownerId))
      .order('desc')
      .collect()
    return rows
      .filter((c) => c.deletedAtMs == null)
      .map((c) => ({
        clientId: c.clientId,
        title: c.title,
        pinned: c.pinned,
        unread: c.unread,
        draft: c.draft,
        updatedAtMs: c.updatedAtMs,
      }))
  },
})

/**
 * Return a full thread (conversation + ordered messages) for one client id.
 *
 * Returns `null` when the conversation doesn't exist remotely yet, so the
 * caller can decide whether to push a fresh local copy.
 */
export const getThread = query({
  args: { clientId: v.string() },
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx)
    const conv = await findConversation(ctx, ownerId, args.clientId)
    if (!conv || conv.deletedAtMs != null) return null
    const messages = await ctx.db
      .query('messages')
      .withIndex('byOwnerConvAndOrder', (q) =>
        q
          .eq('ownerId', ownerId)
          .eq('conversationClientId', args.clientId),
      )
      .order('asc')
      .collect()
    return {
      conversation: {
        clientId: conv.clientId,
        title: conv.title,
        pinned: conv.pinned,
        unread: conv.unread,
        draft: conv.draft,
        updatedAtMs: conv.updatedAtMs,
      },
      messages: messages.map((m) => ({
        clientMsgId: m.clientMsgId,
        role: m.role,
        content: m.content,
        status: m.status,
        createdAtMs: m.createdAtMs,
        orderKey: m.orderKey,
      })),
    }
  },
})

/**
 * Upsert conversation metadata. LWW on `updatedAtMs`.
 *
 * Returns the resulting (post-merge) row so the client can update its local
 * snapshot used for diffing.
 */
export const upsertConversation = mutation({
  args: {
    clientId: v.string(),
    title: v.string(),
    pinned: v.boolean(),
    unread: v.boolean(),
    draft: v.string(),
    updatedAtMs: v.number(),
  },
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx)
    const existing = await findConversation(ctx, ownerId, args.clientId)
    if (!existing) {
      await ctx.db.insert('conversations', {
        ownerId,
        clientId: args.clientId,
        title: args.title,
        pinned: args.pinned,
        unread: args.unread,
        draft: args.draft,
        updatedAtMs: args.updatedAtMs,
      })
      return {
        clientId: args.clientId,
        title: args.title,
        pinned: args.pinned,
        unread: args.unread,
        draft: args.draft,
        updatedAtMs: args.updatedAtMs,
      }
    }
    if (args.updatedAtMs <= existing.updatedAtMs) {
      return {
        clientId: existing.clientId,
        title: existing.title,
        pinned: existing.pinned,
        unread: existing.unread,
        draft: existing.draft,
        updatedAtMs: existing.updatedAtMs,
      }
    }
    await ctx.db.patch(existing._id, {
      title: args.title,
      pinned: args.pinned,
      unread: args.unread,
      draft: args.draft,
      updatedAtMs: args.updatedAtMs,
      deletedAtMs: undefined,
    })
    return {
      clientId: args.clientId,
      title: args.title,
      pinned: args.pinned,
      unread: args.unread,
      draft: args.draft,
      updatedAtMs: args.updatedAtMs,
    }
  },
})

/**
 * Append messages to a conversation (idempotent on `clientMsgId`).
 *
 * The conversation row must already exist (call `upsertConversation` first).
 * Streaming/partial messages should not be sent; the desktop sync layer is
 * responsible for filtering those out.
 */
export const appendMessages = mutation({
  args: {
    conversationClientId: v.string(),
    messages: v.array(messageInputValidator),
  },
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx)
    const conv = await findConversation(ctx, ownerId, args.conversationClientId)
    if (!conv) {
      throw new Error('Conversation does not exist on the server')
    }
    let inserted = 0
    let nextKey = await nextOrderKey(ctx, ownerId, args.conversationClientId)
    for (const m of args.messages) {
      const existing = await ctx.db
        .query('messages')
        .withIndex('byOwnerConvAndClientMsg', (q) =>
          q
            .eq('ownerId', ownerId)
            .eq('conversationClientId', args.conversationClientId)
            .eq('clientMsgId', m.clientMsgId),
        )
        .unique()
      if (existing) continue
      await ctx.db.insert('messages', {
        ownerId,
        conversationClientId: args.conversationClientId,
        clientMsgId: m.clientMsgId,
        role: m.role,
        content: m.content,
        status: m.status,
        createdAtMs: m.createdAtMs,
        orderKey: nextKey,
      })
      nextKey += 1
      inserted += 1
    }
    return { inserted }
  },
})

/**
 * Patch a subset of conversation scalars (title / pinned / unread / draft).
 *
 * Used by sidebar quick actions where we don't have all the fields in scope
 * locally (e.g. just toggling pinned). LWW on `updatedAtMs` still applies.
 * If the conversation doesn't exist on the server yet, the patch is a no-op
 * (the next full `upsertConversation` from the chat workbench save loop will
 * create it).
 */
export const patchConversation = mutation({
  args: {
    clientId: v.string(),
    updatedAtMs: v.number(),
    title: v.optional(v.string()),
    pinned: v.optional(v.boolean()),
    unread: v.optional(v.boolean()),
    draft: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx)
    const existing = await findConversation(ctx, ownerId, args.clientId)
    if (!existing) return { patched: false }
    if (args.updatedAtMs <= existing.updatedAtMs) return { patched: false }
    const patch: Partial<Doc<'conversations'>> = {
      updatedAtMs: args.updatedAtMs,
    }
    if (args.title !== undefined) patch.title = args.title
    if (args.pinned !== undefined) patch.pinned = args.pinned
    if (args.unread !== undefined) patch.unread = args.unread
    if (args.draft !== undefined) patch.draft = args.draft
    await ctx.db.patch(existing._id, patch)
    return { patched: true }
  },
})

/**
 * Soft-delete a conversation. Messages are kept in the table so concurrent
 * devices can still see history if they want to undelete; V1 just hides them.
 */
export const softDelete = mutation({
  args: { clientId: v.string(), updatedAtMs: v.number() },
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx)
    const existing = await findConversation(ctx, ownerId, args.clientId)
    if (!existing) return { deleted: false }
    await ctx.db.patch(existing._id, {
      deletedAtMs: args.updatedAtMs,
      updatedAtMs: Math.max(existing.updatedAtMs, args.updatedAtMs),
    })
    return { deleted: true }
  },
})
