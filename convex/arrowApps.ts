import { v } from 'convex/values'

import type { Doc } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'
import { mutation, query } from './_generated/server'
import { requireUserId } from './lib/auth'

async function findMeta(
  ctx: QueryCtx | MutationCtx,
  ownerId: Doc<'users'>['_id'],
  workspaceClientId: string,
): Promise<Doc<'arrowWorkspaceMeta'> | null> {
  return ctx.db
    .query('arrowWorkspaceMeta')
    .withIndex('byOwnerAndWorkspace', (q) =>
      q.eq('ownerId', ownerId).eq('workspaceClientId', workspaceClientId),
    )
    .unique()
}

async function findApp(
  ctx: QueryCtx | MutationCtx,
  ownerId: Doc<'users'>['_id'],
  workspaceClientId: string,
  appId: string,
): Promise<Doc<'arrowApps'> | null> {
  return ctx.db
    .query('arrowApps')
    .withIndex('byOwnerWsAndApp', (q) =>
      q
        .eq('ownerId', ownerId)
        .eq('workspaceClientId', workspaceClientId)
        .eq('appId', appId),
    )
    .unique()
}

export const workspaceBundle = query({
  args: { workspaceClientId: v.string() },
  handler: async (ctx, { workspaceClientId }) => {
    const ownerId = await requireUserId(ctx)
    const meta = await findMeta(ctx, ownerId, workspaceClientId)
    const rows = await ctx.db
      .query('arrowApps')
      .withIndex('byOwnerWsAndApp', (q) =>
        q.eq('ownerId', ownerId).eq('workspaceClientId', workspaceClientId),
      )
      .collect()
    const apps = rows
      .filter((r) => r.deletedAtMs == null)
      .map((r) => ({
        appId: r.appId,
        title: r.title,
        mainTs: r.mainTs,
        mainCss: r.mainCss ?? '',
        manifestJson: r.manifestJson ?? '',
        updatedAtMs: r.updatedAtMs,
      }))
      .sort((a, b) => a.appId.localeCompare(b.appId))
    const deletedApps = rows
      .filter((r) => r.deletedAtMs != null)
      .map((r) => ({
        appId: r.appId,
        updatedAtMs: r.updatedAtMs,
      }))
    return {
      meta: {
        activeAppId: meta?.activeAppId ?? null,
        updatedAtMs: meta?.updatedAtMs ?? 0,
      },
      apps,
      deletedApps,
    }
  },
})

const upsertAppArgs = v.object({
  workspaceClientId: v.string(),
  appId: v.string(),
  title: v.string(),
  mainTs: v.string(),
  mainCss: v.optional(v.string()),
  manifestJson: v.optional(v.string()),
  updatedAtMs: v.number(),
})

export const upsertApp = mutation({
  args: upsertAppArgs,
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx)
    const existing = await findApp(
      ctx,
      ownerId,
      args.workspaceClientId,
      args.appId,
    )
    if (existing && args.updatedAtMs <= existing.updatedAtMs) {
      return { ok: true as const, skipped: true as const }
    }
    const patch = {
      ownerId,
      workspaceClientId: args.workspaceClientId,
      appId: args.appId,
      title: args.title,
      mainTs: args.mainTs,
      mainCss: args.mainCss,
      manifestJson: args.manifestJson,
      updatedAtMs: args.updatedAtMs,
      deletedAtMs: undefined,
    }
    if (existing) {
      await ctx.db.patch(existing._id, patch)
    } else {
      await ctx.db.insert('arrowApps', patch)
    }
    return { ok: true as const, skipped: false as const }
  },
})

export const setWorkspaceMeta = mutation({
  args: v.object({
    workspaceClientId: v.string(),
    activeAppId: v.union(v.string(), v.null()),
    updatedAtMs: v.number(),
  }),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx)
    const existing = await findMeta(ctx, ownerId, args.workspaceClientId)
    if (existing && args.updatedAtMs <= existing.updatedAtMs) {
      return { ok: true as const, skipped: true as const }
    }
    const row = {
      ownerId,
      workspaceClientId: args.workspaceClientId,
      activeAppId: args.activeAppId,
      updatedAtMs: args.updatedAtMs,
    }
    if (existing) {
      await ctx.db.patch(existing._id, row)
    } else {
      await ctx.db.insert('arrowWorkspaceMeta', row)
    }
    return { ok: true as const, skipped: false as const }
  },
})

export const softDeleteApp = mutation({
  args: v.object({
    workspaceClientId: v.string(),
    appId: v.string(),
    updatedAtMs: v.number(),
  }),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx)
    const existing = await findApp(
      ctx,
      ownerId,
      args.workspaceClientId,
      args.appId,
    )
    if (!existing) return { ok: true as const, skipped: true as const }
    if (args.updatedAtMs <= existing.updatedAtMs) {
      return { ok: true as const, skipped: true as const }
    }
    await ctx.db.patch(existing._id, {
      updatedAtMs: args.updatedAtMs,
      deletedAtMs: args.updatedAtMs,
    })
    return { ok: true as const, skipped: false as const }
  },
})
