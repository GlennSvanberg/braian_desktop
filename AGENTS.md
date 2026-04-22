# AGENTS.md — Braian Desktop

Instructions for coding agents working in this repository.

## Product direction

Braian Desktop is a **local-first**, **chat-first** AI workspace that will grow into an **artifact / dashboard**-centric UI (see [`NOTES.md`](NOTES.md)). The web tech stack runs inside a **Tauri** shell with access to the filesystem and a local **SQLite** database.

## Tech stack

| Layer | Choice |
|--------|--------|
| Desktop shell | **Tauri 2** (`src-tauri/`, Rust) |
| UI | **React 19** + **TanStack Start** + **TanStack Router** (file routes under `src/routes/`) |
| Styling | **Tailwind CSS v4** + **single global stylesheet** [`src/styles/app.css`](src/styles/app.css) |
| Components | **shadcn/ui** (Radix primitives), see [`components.json`](components.json) |
| Local DB | **SQLite** via **`rusqlite`** in Rust; DB file `braian.db` under the app data directory, initialized on startup (`_schema_version` table + `SELECT 1` sanity check) |
| LLM / tools (TS) | **[TanStack AI](https://tanstack.com/ai/latest)** — multi-provider, BYOK-oriented integration; see [`docs/AI.md`](docs/AI.md) for decisions and caveats (library is **alpha**) |

An **opt-in cloud sync layer** lives in `convex/` and `src/lib/cloud/`. It is off by default; the desktop app remains fully usable without any cloud account. See [Cloud sync (Convex)](#cloud-sync-convex) below.

## AI integration

- **Rationale and alternatives:** [`docs/AI.md`](docs/AI.md).
- **TanStack AI usage (skill):** Install `tanstack-skills/tanstack-skills@tanstack-ai` via `npx skills add …` — see [`docs/AI.md`](docs/AI.md#agent-skill-usage-patterns) for the exact command and skills.sh link.
- **Execution boundary:** Prefer **Tauri commands** (and later MCP) for filesystem and shell-like actions; keep paths scoped to the user’s workspace. The model can use a shell-**shaped** tool that is **implemented** in Rust, not arbitrary webview shell access.
- **UI contract:** Real adapters should preserve artifact/stream chunk shapes used by the workspace panel (`src/lib/ai/types.ts`, `src/lib/artifacts/`).
- **Workspace mini-apps (Arrow):** Interactive apps live under `.braian/arrow-apps/` and are built with **Arrow JS** sandboxes, not the old Vite `.braian/webapp` template. Agent instructions: bundled [`src-tauri/skills-default/app-builder/SKILL.md`](src-tauri/skills-default/app-builder/SKILL.md); API subset for sandboxes [`docs/ARROW_SANDBOX_SUBSET.md`](docs/ARROW_SANDBOX_SUBSET.md); on-brand `main.css` [`docs/ARROW_APP_DESIGN.md`](docs/ARROW_APP_DESIGN.md); maintainer notes [`docs/ARROW_APPS.md`](docs/ARROW_APPS.md).

## Commands

- **Web only (browser):** `npm run dev` — Vite on port **3000** (`strictPort`).
- **Desktop:** `npm run tauri:dev` (or `npx tauri dev`) — runs `beforeDevCommand` (`npm run dev`) and opens the WebView to `http://localhost:3000`.
- **Production web build:** `npm run build` — static client assets for Tauri live in **`dist/client/`** (`src-tauri/tauri.conf.json` → `build.frontendDist`). (Some TanStack Start versions emit `.output/public` instead; if you upgrade and the path changes, update `frontendDist` to match.)
- **Desktop release build:** `npm run tauri:build`.
- **Tests:** `npm run test` (Vitest). **Headless AI evaluation** (`ai:dump`, `ai:stream`) and how they map to manual QA live in [`TESTING.md`](TESTING.md); chat scenarios are listed in [`testcases.md`](testcases.md).

## Styling contract

- **Do not** scatter arbitrary hex colors in TSX.
- **Do** define and consume tokens in [`src/styles/app.css`](src/styles/app.css). Human-readable tables and theme notes: [`docs/STYLING.md`](docs/STYLING.md).

## Repository layout

- `src/routes/` — file-based routes (`__root.tsx`, `index.tsx`, …)
- `src/components/` — app UI; `src/components/ui/` — shadcn primitives
- `src/lib/` — shared TS utilities (`cn`, etc.)
- `src/styles/app.css` — **only** global CSS entry (imported from `__root.tsx`)
- `src-tauri/src/` — Rust entry (`lib.rs`, commands, plugins)
- **Workspace Git snapshots:** `src-tauri/src/workspace_git.rs` (libgit2 via `git2`), toggled per workspace with `.braian/git-history.json`; TS bridge `src/lib/workspace/git-history-api.ts`, debounced auto-checkpoints `src/lib/workspace/workspace-activity.ts`. User-facing doc: `docs/app/workspace-history.md`.

## SQLite notes

- Opening and migration scaffolding live in **`src-tauri`** (`rusqlite`, bundled SQLite).
- If most data access should move to the frontend later, consider **`@tauri-apps/plugin-sql`**; for now the DB is validated from Rust only.

## Zod schemas for LLM tool definitions (OpenAI compatibility)

This project uses **Zod v4** (`^4.x`) with `@tanstack/ai` `toolDefinition()`. Zod schemas are converted to **JSON Schema** and sent to providers like OpenAI as function parameter schemas. **OpenAI's function calling API is strict** about which JSON Schema features it accepts — many valid JSON Schema constructs are rejected at runtime with `400` errors.

### Rules — follow these when writing any `z.object({...})` for a tool `inputSchema`

1. **Never use `z.record()`**. It emits `propertyNames` in JSON Schema, which OpenAI rejects.
   ```ts
   // BAD — OpenAI rejects `propertyNames`
   z.record(z.string(), z.string())
   z.record(z.string())

   // GOOD — use z.object({}).passthrough() for arbitrary key/value objects
   z.object({}).passthrough().describe('JSON object with string keys.')
   ```

2. **Never use `z.any()` or `z.unknown()`**. They emit `{}` (empty schema) with no `type` key, which OpenAI rejects.
   ```ts
   // BAD — no `type` key in JSON Schema output
   z.array(z.any())
   z.any()

   // GOOD — use z.string() and JSON-encode complex/dynamic data
   z.string().describe('JSON-encoded array of objects. Example: [{"a":1}]')
   ```

3. **Every schema node must have a `type`**. All properties, array items, and nested objects need an explicit Zod type that maps to a JSON Schema `type` (`string`, `number`, `boolean`, `object`, `array`).

4. **For dynamic/arbitrary objects as tool input**, encode as a JSON string and parse in the handler:
   ```ts
   const schema = z.object({
     dataJson: z.string().describe('JSON-encoded data. Example: [{"col":"val"}]'),
   })
   // In handler:
   const data = JSON.parse(input.dataJson)
   ```

5. **Allowed Zod types for tool schemas**: `z.string()`, `z.number()`, `z.boolean()`, `z.literal()`, `z.enum()`, `z.object({...})`, `z.array(typedItem)`, `z.union([...])` (typed variants), `z.optional()`, `z.null()`. Combine only these.

6. **Existing helper** (`src/lib/ai/mcp-tools.ts`): `stripPropertyNamesFromJsonSchema()` recursively removes `propertyNames` from external MCP schemas. For **our own** tool schemas, avoid the problem at the source by following the rules above instead of relying on stripping.

## Cloud sync (Convex)

Optional, end-to-end-typed sync of **conversations and messages** to a Convex deployment so the same threads can be viewed/continued from a browser or another device. Local files remain the canonical source of truth; the cloud is a **replica**.

### Enabling it

1. Provision a deployment with `npx convex dev` (writes `CONVEX_DEPLOYMENT`, `VITE_CONVEX_URL`, and `VITE_CONVEX_SITE_URL` to `.env.local`, and overwrites the stubs in `convex/_generated/`).
2. **Provision Convex Auth keys** with `npx @convex-dev/auth`. This generates an RSA keypair and sets `JWT_PRIVATE_KEY`, `JWKS`, and `SITE_URL` (default `http://localhost:3000`) on the **Convex deployment** (not in `.env.local`). Without this step, `auth:signIn` fails with `Missing environment variable JWT_PRIVATE_KEY`.
3. **Provision the API-key encryption secret** for the web chat proxy: generate 32 random bytes (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) and set `BRAIAN_KEY_ENCRYPTION_KEY` on the Convex deployment (`npx convex env set BRAIAN_KEY_ENCRYPTION_KEY <hex>`). Without this, `userApiKeys.setApiKey` and `/provider-proxy/...` fail. Cloud sync of *threads* still works without it; only the web chat path needs it.
4. `VITE_CONVEX_URL` is read by `getConvexClient()` at app start. When the variable is unset, `isCloudConfigured()` returns `false` and **no cloud code runs** — the app behaves exactly as before.
5. Sign in via the Cloud sync card on the **User / Profile** page (`src/components/app/auth/sign-in-card.tsx`). V1 uses Convex Auth's `Password` provider (email + password).
6. To chat **from a browser**, also enter a per-provider API key in the same card (OpenAI / Anthropic / Gemini). Keys are AES-GCM-encrypted with `BRAIAN_KEY_ENCRYPTION_KEY` and the proxy injects them server-side; the browser never holds the raw key.

### Architecture

| Concern | Module |
|---------|--------|
| Schema (`conversations`, `messages` + `authTables`) | `convex/schema.ts` |
| Server-side auth helpers | `convex/auth.ts`, `convex/auth.config.ts`, `convex/http.ts`, `convex/lib/auth.ts` |
| Queries/mutations | `convex/conversations.ts` (`listMine`, `getThread`, `upsertConversation`, `appendMessages`, `patchConversation`, `softDelete`) |
| Lazy client | `src/lib/cloud/convex-client.ts` (`getConvexClient`, `isCloudConfigured`) |
| Auth bridge for non-React code | `src/lib/cloud/auth-state.tsx` (`isCloudEnabled`) |
| Conditional provider | `src/components/app/auth/cloud-auth-provider.tsx` (mounted from `src/routes/_shell/route.tsx`) |
| Pure diff/merge logic | `src/lib/cloud/diff.ts` (unit-tested in `diff.test.ts`) |
| Snapshot cache | `src/lib/cloud/snapshot-store.ts` (per-conversation cache in `localStorage`) |
| Sync facade (queue, retries, push/pull) | `src/lib/cloud/sync.ts` |
| Sidebar bucket constant | `src/lib/cloud/workspace.ts` (`CLOUD_WORKSPACE_SESSION_ID`) |
| Live list subscription | `src/components/app/cloud-conversations-sync.tsx` |
| Web chat proxy (server) | `convex/userApiKeys.ts`, `convex/providerProxy.ts`, `convex/lib/crypto.ts`, `convex/http.ts` |
| Web chat proxy (client) | `src/lib/cloud/provider-proxy-fetch.ts`, `src/lib/cloud/cloud-chat-stream.ts` |
| API key UI | `src/components/app/auth/provider-key-form.tsx` |

### Sync semantics

- **Push** runs through `mirrorToCloudSave` / `mirrorToCloudPartial` / `mirrorToCloudDelete` from `src/lib/workspace-api.ts`. They are fire-and-forget calls placed **after** local persistence; failures must never break the desktop write path.
- **Conflict resolution:** scalar conversation fields are last-write-wins by `updatedAtMs`; messages are append-only keyed by `clientMsgId` with a server-assigned monotonic `orderKey`. Soft delete via `deletedAtMs`.
- **Pull** happens lazily on `conversationOpen` (merging via `mergeCloudIntoOpenResult`) and via the live `listMine` subscription that feeds the sidebar's cloud bucket.
- **Streaming messages are not pushed** until they reach `complete`; they sync on the next save.

### Web chat proxy (BYOK)

When `tanstack-chat-stream.ts` is invoked outside Tauri, it falls through to `streamCloudChatTurn` instead of throwing. That path:

1. Reads the user's provider/model selection from `aiSettingsGet()` (which works in the browser via localStorage).
2. Uses the existing `@tanstack/ai-{openai|anthropic|gemini}` adapter, but with a `fetch` shim that rewrites `api.openai.com` / `api.anthropic.com` / `generativelanguage.googleapis.com` URLs to `${VITE_CONVEX_SITE_URL}/provider-proxy/<provider>/...` and adds the Convex Auth bearer token.
3. The Convex `providerProxy.ts` HTTP action authenticates the user, looks up their AES-GCM-encrypted key from `userApiKeys`, decrypts it server-side, and forwards the request to the upstream provider, streaming the response body back unchanged.

**Web chat is intentionally minimal** (V1 scope): no tools, no MCP, no skills, no workspace files, no retrieval/memory. Any of those features needs the Tauri runtime. To extend the web path, build server-side equivalents (e.g. via Convex Agent component) rather than wedging Tauri-only modules into the browser bundle.

### When editing this layer

- Keep `convex/_generated/` checked in as **stubs**; running `npx convex dev` will overwrite them with real types and that's expected.
- Anything in `src/lib/cloud/diff.ts` must remain pure (no Convex imports) so it is unit-testable. Add cases to `diff.test.ts` when adjusting the wire shape.
- Never introduce a hard dependency on `VITE_CONVEX_URL` from non-cloud modules — guard with `isCloudConfigured()` / `isCloudEnabled()`.
- New scalar conversation fields that should sync need: schema entry in `convex/schema.ts`, `upsertConversation` + `patchConversation` args, `CloudConversationFields` shape, `mergeScalarsLww` overlay, and a snapshot field — keep all five in lockstep.

## Reference projects

- Earlier web prototype (colors only, for history): `C:\git\glenn\braian\`
- Tauri + TanStack Start pattern inspiration: [kvnxiao/tauri-tanstack-start-react-template](https://github.com/kvnxiao/tauri-tanstack-start-react-template)
