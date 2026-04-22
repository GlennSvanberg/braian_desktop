# Arrow API subset — Braian workspace apps

Braian runs workspace UI as **`@arrow-js/sandbox`** bundles: virtual files in `sandbox({ source: { 'main.ts': …, 'main.css'?: … } })` inside **QuickJS / WASM**. This is **not** the same as a scaffolded Vite + SSR Arrow app.

Use this doc as the **contract** for what agents and validators assume. For exhaustive Arrow APIs, read the vendored **`.arrow-js/skill/api.md`** in this repo — but only use APIs that work in this environment.

## In scope (`main.ts`)

- **`@arrow-js/core`**: `reactive`, `html`, `component`, `watch`, `onCleanup` as needed. Prefer `import { … } from '@arrow-js/core'` or rely on globals injected by the sandbox (both are valid in Braian’s flow).
- **Default export:** root **`html`…\``** template or **`component(…)`** returning that shape — never `export default function App()`.
- **Reactive template slots:** dynamic reads as **callables** in the template (Arrow’s rule), e.g. `${() => state.n}` not a one-time static snapshot where reactivity is required.
- **Events:** Arrow **`@click`**, `@input`, etc. — never React-style `onClick=` / `onChange=`.
- **`output(payload)`:** global in the VM; send **JSON-serializable** data to the host (`events.output` in Braian).

Aligned with static checks in `src/lib/workspace-arrow-apps/validate-arrow-main-ts.ts` and optional browser smoke test there.

## Out of scope (do not use in `.braian/arrow-apps/`)

- **`@arrow-js/framework`** — `render`, `boundary`, async app shell.
- **`@arrow-js/ssr`** — `renderToString`, `serializePayload`.
- **`@arrow-js/hydrate`** — `hydrate`, `readPayload`.
- **Scaffold / routing:** `pnpm create arrow-js@latest`, `routeToPage`, `server.mjs`, multi-file client entry — see `.arrow-js/skill/getting-started.md` for *full* Arrow products, not Braian sandboxes.
- **Other UI frameworks:** React, Vue, Preact imports (rejected by validation).
- **Invented packages:** e.g. `@braian/*` inside the VM (rejected).

## Full API reference (read selectively)

- **`.arrow-js/skill/api.md`** — complete Arrow surface; apply only what compiles and runs inside the sandbox with the allowed virtual `source` tree.
- **`.arrow-js/skill/examples.md`** — patterns; skip SSR/hydration examples for workspace apps.

## Related

- [ARROW_APPS.md](ARROW_APPS.md) — layout, tools, troubleshooting.
- [ARROW_APP_DESIGN.md](ARROW_APP_DESIGN.md) — `main.css` and on-brand UI.
- Bundled agent skill: `src-tauri/skills-default/app-builder/SKILL.md`.
