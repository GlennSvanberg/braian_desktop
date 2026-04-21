import { authTables } from '@convex-dev/auth/server'
import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

/**
 * Convex schema for Braian cloud sync (V1).
 *
 * V1 sync scope (matches the plan):
 * - One synthetic "personal" workspace bucket per user. Workspaces aren't
 *   actually modelled; everything a user owns lives under their `ownerId`.
 * - `conversations` and `messages` are mirrored from the desktop file store.
 * - `arrowWorkspaceMeta` + `arrowApps` mirror per-workspace Arrow sandbox apps
 *   (`.braian/arrow-apps.json` + `.braian/arrow-apps/<id>/`), keyed by the same
 *   `workspaceClientId` string the desktop SQLite uses for folder workspaces
 *   and `CLOUD_WORKSPACE_SESSION_ID` for the web-only cloud bucket.
 *
 * Identifiers:
 * - `clientId` is the desktop conversation `id` (UUID generated locally).
 *   Reusing the same ID end-to-end avoids any translation layer between
 *   the cloud copy and the on-disk `ConversationFileV1`.
 * - `clientMsgId` is the desktop message `id`. Append-only, idempotent on
 *   re-push so the offline write queue is safe to retry.
 */
export default defineSchema({
  ...authTables,

  conversations: defineTable({
    ownerId: v.id('users'),
    clientId: v.string(),
    title: v.string(),
    pinned: v.boolean(),
    unread: v.boolean(),
    draft: v.string(),
    /** Last update timestamp authored by a client. Used for LWW. */
    updatedAtMs: v.number(),
    /** Soft-delete; clients hide rows where this is set and newer than local. */
    deletedAtMs: v.optional(v.number()),
  })
    .index('byOwnerAndClient', ['ownerId', 'clientId'])
    .index('byOwnerAndUpdated', ['ownerId', 'updatedAtMs']),

  /**
   * Per-user provider API keys for the cloud chat proxy.
   *
   * Stored AES-GCM-encrypted; the encryption key lives in the
   * `BRAIAN_KEY_ENCRYPTION_KEY` Convex env var. Nothing here should ever be
   * returned to a client; queries return existence + a "last 4" hint only.
   */
  userApiKeys: defineTable({
    ownerId: v.id('users'),
    provider: v.union(
      v.literal('openai'),
      v.literal('anthropic'),
      v.literal('gemini'),
    ),
    /** Base64 ciphertext (AES-GCM). */
    cipherText: v.string(),
    /** Base64 IV (12 bytes). */
    iv: v.string(),
    /** Last 4 chars of the cleartext key, for UI hint. */
    lastFour: v.string(),
    updatedAtMs: v.number(),
  }).index('byOwnerAndProvider', ['ownerId', 'provider']),

  messages: defineTable({
    ownerId: v.id('users'),
    /** Matches `conversations.clientId` (the desktop conversation `id`). */
    conversationClientId: v.string(),
    /** The desktop message `id`. Unique per (owner, conversation). */
    clientMsgId: v.string(),
    role: v.union(v.literal('user'), v.literal('assistant')),
    content: v.string(),
    /** Optional persisted status; we only push `complete` (or unset). */
    status: v.optional(v.string()),
    /** Optional millisecond client timestamp. */
    createdAtMs: v.optional(v.number()),
    /**
     * Monotonic ordering key assigned by the server on first insert. We don't
     * trust client timestamps for ordering because two devices can have
     * skewed clocks; clients still send messages in their local order and the
     * server appends in arrival order.
     */
    orderKey: v.number(),
  })
    .index('byOwnerConvAndOrder', [
      'ownerId',
      'conversationClientId',
      'orderKey',
    ])
    .index('byOwnerConvAndClientMsg', [
      'ownerId',
      'conversationClientId',
      'clientMsgId',
    ]),

  /**
   * Per-workspace Arrow app index metadata (active app + ordering is derived
   * from app rows; this row only tracks `activeAppId` + LWW stamp).
   */
  arrowWorkspaceMeta: defineTable({
    ownerId: v.id('users'),
    workspaceClientId: v.string(),
    activeAppId: v.union(v.string(), v.null()),
    updatedAtMs: v.number(),
  }).index('byOwnerAndWorkspace', ['ownerId', 'workspaceClientId']),

  /**
   * One row per Arrow app under a workspace. Large `mainTs` payloads are
   * client-bounded before upload; Convex document limits still apply.
   */
  arrowApps: defineTable({
    ownerId: v.id('users'),
    workspaceClientId: v.string(),
    appId: v.string(),
    title: v.string(),
    mainTs: v.string(),
    mainCss: v.optional(v.string()),
    manifestJson: v.optional(v.string()),
    /** Client-authored LWW field; bumps on writes and soft-deletes. */
    updatedAtMs: v.number(),
    deletedAtMs: v.optional(v.number()),
  }).index('byOwnerWsAndApp', ['ownerId', 'workspaceClientId', 'appId']),
})
