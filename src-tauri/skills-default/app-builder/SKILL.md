---
name: app-builder
description: Braian workspace Arrow JS sandbox apps (.braian/arrow-apps). Use after switch_to_app_builder and lazy tool discovery.
---

## Workspace Arrow apps (sandboxed UI)

Interactive UI for this workspace lives as **Arrow JS** sandboxes under **`.braian/arrow-apps/<appId>/`**, indexed by **`.braian/arrow-apps.json`**. **Dashboard → Apps** lists apps and opens a live preview. **App mode** shows the active app in the chat **artifact** panel.

There is **no** Vite, **no** React in the sandbox, **no** `npm run dev`, and **no** `.braian/webapp/` flow — only Arrow + tools.

### Reference docs (read in this order)

1. **Braian sandbox contract:** `docs/ARROW_SANDBOX_SUBSET.md` — what Arrow APIs actually run in QuickJS + virtual `source` (ignore Vite/SSR/hydration from generic Arrow docs).
2. **On-brand UI:** `docs/ARROW_APP_DESIGN.md` — `:host` CSS tokens, typography, buttons, inputs (Shadow DOM does not inherit shell Tailwind).
3. **Full Arrow API (selective use):** repo `.arrow-js/skill/api.md` (refresh vendored skill with `npx @arrow-js/skill@latest` — see `docs/ARROW_APPS.md`).

### Official contract (keep in sync with tools)

Build each app for `sandbox({ source })` with exactly one entry **`main.ts`** (or `main.js`), optional **`main.css`**.

- Use **`@arrow-js/core`** primitives only: **`reactive`**, **`html`**, **`component`**, **`watch`**, **`onCleanup`** when needed. Identifiers can be used as globals in the sandbox (they are injected).
- **Never** invent packages such as **`@braian/arrow`** — they do not exist in the VM and will fail validation.
- **No JSX**, no React hooks, no Vue, no direct `document`/`window` mutation in user code.
- **Default export** from `main.ts` must be the root **`html` tagged template** (or **`component(...)`** returning that). **Never** `export default function App() { return html… }` (React style).
- **Live reactive slots** must be **callables** (Arrow rule): wrap dynamic reads in a function in the template slot — not a one-time static value.
- **Events:** use `@click` (and other `@`-bindings) with a function handler per [Arrow docs](https://arrow-js.com/). **Never** `onClick=` / `onChange=` (React).
- **`output(payload)`** — global in the VM; send **one JSON-serializable** value to the host (`events.output` in Braian). Use for form submits or status.

### Automatic validation (Braian)

The **`write_arrow_app`** tool runs **static checks** on every `main.ts` (banned imports, React handlers, wrong default-export shape). In the **desktop/webview host** it also runs a **quick sandbox smoke test** (compile + mount in a hidden node). **Invalid code is not written** — the model sees the error string and must fix and retry.

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

### Theming and Braian look-and-feel

- **Always ship `main.css`** for any real UI (forms, dashboards, multi-section layouts). The sandbox uses **Shadow DOM**; Braian’s outer card is themed, but **your template does not inherit** `bg-app-*` / Tailwind from the host — you must define colors in `main.css`.
- Follow **`docs/ARROW_APP_DESIGN.md`**: copy the **`:host { … }` token block** (dark default + optional `prefers-color-scheme: light`), then use classes like **`ba-app`**, **`ba-card`**, **`ba-btn ba-btn--primary`** so apps match the **green-accent neutral** shell ([docs/STYLING.md](docs/STYLING.md)).
- **Starter `main.css`** (minimal — expand from ARROW_APP_DESIGN):

```css
:host {
  color-scheme: dark;
  --ba-bg-0: #0f1114;
  --ba-bg-1: #151a1f;
  --ba-border: #222a32;
  --ba-text-1: #f2f2ee;
  --ba-text-2: #cbc7be;
  --ba-text-3: #8f8a80;
  --ba-accent: #3e8e6c;
  --ba-accent-hover: #347a5d;
  --ba-radius: 0.5rem;
  --ba-font: ui-sans-serif, system-ui, sans-serif;
  font-family: var(--ba-font);
  font-size: 0.9375rem;
  line-height: 1.5;
  color: var(--ba-text-2);
  background: var(--ba-bg-0);
}
```

- In **`main.ts`**, wrap the root in **`<main class="ba-app">`** (and inner **`ba-card`** / **`ba-btn`** as needed) after you add the full component rules from the design doc.

### After changes

Call **`set_active_arrow_app`** when the user should see a different app. After **`write_arrow_app`**, the user may need to finish the chat turn or hit **Reload** on the Apps view for the latest `main.ts` to load.

### Troubleshooting

- **Syntax errors in `main.ts`:** fix and re-run `write_arrow_app`; errors surface in the artifact panel (and the Apps preview after a host fix).
- **Empty / blank panel:** ensure `export default` is a root **`html\`...\``** template (or `component(...)`), not a React-style function component. Use **`@click="${handler}"`**, never **`onClick`**. Imports: only **`@arrow-js/core`** (or omit imports and use injected globals) — there is **no** `@braian/arrow` or other host package inside the VM.
- **Unknown app id:** run `list_arrow_apps` first.

### Agent payload shape (reference)

Aligned with Arrow’s documented `create_arrow_sandbox` tool schema: virtual files object with **`main.ts`** required, **`main.css`** optional, no unsupported imports.
