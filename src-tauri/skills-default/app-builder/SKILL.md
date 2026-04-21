---
name: app-builder
description: Braian workspace Arrow JS sandbox apps (.braian/arrow-apps). Use after switch_to_app_builder and lazy tool discovery.
---

## Workspace Arrow apps (sandboxed UI)

Interactive UI for this workspace lives as **Arrow JS** sandboxes under **`.braian/arrow-apps/<appId>/`**, indexed by **`.braian/arrow-apps.json`**. **Dashboard → Apps** lists apps and opens a live preview. **App mode** shows the active app in the chat **artifact** panel.

There is **no** Vite, **no** React in the sandbox, **no** `npm run dev`, and **no** `.braian/webapp/` flow — only Arrow + tools.

### Official contract (keep in sync with tools)

Build each app for `sandbox({ source })` with exactly one entry **`main.ts`** (or `main.js`), optional **`main.css`**.

- Use **`@arrow-js/core`** primitives only: **`reactive`**, **`html`**, **`component`**, **`watch`**, **`onCleanup`** when needed. Identifiers can be used as globals in the sandbox (they are injected).
- **No JSX**, no React hooks, no Vue, no direct `document`/`window` mutation in user code.
- **Default export** from `main.ts` must be the root `html` template literal (or a `component(...)` result).
- **Live reactive slots** must be **callables** (Arrow rule): wrap dynamic reads in a function in the template slot — not a one-time static value.
- **Events:** use `@click` (and other `@`-bindings) with a function handler per [Arrow docs](https://arrow-js.com/).
- **`output(payload)`** — global in the VM; send **one JSON-serializable** value to the host (`events.output` in Braian). Use for form submits or status.

### File layout (Braian)

| Path | Purpose |
|------|---------|
| `.braian/arrow-apps.json` | Index: `{ schemaVersion: 1, activeAppId, apps: [{ id, title, updatedAtMs }] }` |
| `.braian/arrow-apps/<appId>/main.ts` | Entry source (required) |
| `.braian/arrow-apps/<appId>/main.css` | Optional styles |
| `.braian/arrow-apps/<appId>/manifest.json` | Optional duplicate metadata (written by `write_arrow_app`) |

**`appId`:** lowercase slug, starts with letter or digit, only `a-z`, `0-9`, hyphens (e.g. `email-checker`, `invoice-dashboard`).

### Tools (always use these names)

- **`list_arrow_apps`** — read the index.
- **`read_arrow_app`** — return `main.ts` / `main.css` / manifest for an id.
- **`write_arrow_app`** — create or replace `main.ts`, optional `main.css`, update index entry, bump `updatedAtMs`. Sets **`activeAppId`** to the new id when none was set.
- **`delete_arrow_app`** — remove the app folder and index entry.
- **`set_active_arrow_app`** — which app the **Apps** tab / App-mode artifact shows (must exist in index).

You may also use normal **`read_workspace_file`** / **`write_workspace_file`** on paths under `.braian/arrow-apps/` if you need raw edits.

### Minimal examples

**Counter**

```ts
const state = reactive({ count: 0 })

export default html`
  <button @click="${() => state.count++}">Count: ${() => state.count}</button>
`
```

**Notify host**

```ts
output({ type: 'ready', app: 'demo' })

export default html`<p>Hello from Arrow</p>`
```

### Theming

Prefer semantic, readable HTML and scoped **`main.css`**. Avoid unreadable tiny gray-on-gray text. The host shell is themed; sandbox runs in a card — keep contrast reasonable.

### After changes

Call **`set_active_arrow_app`** when the user should see a different app. After **`write_arrow_app`**, the user may need to finish the chat turn or hit **Reload** on the Apps view for the latest `main.ts` to load.

### Troubleshooting

- **Syntax errors in `main.ts`:** fix and re-run `write_arrow_app`; errors surface in the artifact panel.
- **Empty panel:** ensure `export default` exists and is an Arrow template.
- **Unknown app id:** run `list_arrow_apps` first.

### Agent payload shape (reference)

Aligned with Arrow’s documented `create_arrow_sandbox` tool schema: virtual files object with **`main.ts`** required, **`main.css`** optional, no unsupported imports.
