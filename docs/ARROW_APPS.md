# Workspace Arrow apps

Braian’s **workspace apps** are **[Arrow JS](https://arrow-js.com/)** sandboxes (`@arrow-js/core` + `@arrow-js/sandbox`), not a Vite/React tree.

## Layout

| Path | Role |
|------|------|
| `.braian/arrow-apps.json` | Index: `activeAppId`, `apps[]` with `id`, `title`, `updatedAtMs` |
| `.braian/arrow-apps/<appId>/main.ts` | Required entry; default export = root template |
| `.braian/arrow-apps/<appId>/main.css` | Optional |
| `.braian/arrow-apps/<appId>/manifest.json` | Optional metadata (tool-maintained) |

## UI surfaces

- **Dashboard → Apps:** loads the active app (or first listed) into a sandbox mount.
- **App agent mode artifact:** same, after each chat turn the panel may reload sources.

## AI harness

- Bundled skill: `src-tauri/skills-default/app-builder/SKILL.md`
- Tools: `src/lib/ai/arrow-app-tools.ts` (`list_arrow_apps`, `read_arrow_app`, `write_arrow_app`, `delete_arrow_app`, `set_active_arrow_app`)
- Routing text: `APP_MODE_ROUTING_ADDENDUM` in `src/lib/ai/braian-routing-prompt.ts`
- **What Braian actually runs:** [ARROW_SANDBOX_SUBSET.md](ARROW_SANDBOX_SUBSET.md) (subset of Arrow APIs inside QuickJS sandbox)
- **Visual DNA for `main.css`:** [ARROW_APP_DESIGN.md](ARROW_APP_DESIGN.md)

### Refreshing the official Arrow skill (maintainers)

Generic Arrow documentation is **vendored** under `.arrow-js/skill/` and referenced from `.cursorrules` and `.github/copilot-instructions.md`.

1. From the **repository root**, run:

   ```bash
   npx @arrow-js/skill@latest
   ```

   Confirm the generator writes or updates files under **`.arrow-js/skill/`** (paths may vary by package version).

2. **Review the diff** — merge upstream wording changes; keep Braian-specific notes in this file and in [ARROW_SANDBOX_SUBSET.md](ARROW_SANDBOX_SUBSET.md).

3. If the skill package **adds or renames** markdown files, update the `<!-- arrow-js-skill:start -->` … `<!-- arrow-js-skill:end -->` block in `.cursorrules` and `.github/copilot-instructions.md` so the bullet list matches what exists on disk.

4. **Do not** treat every section of the official skill as applicable to **workspace Arrow apps**: Braian uses **`sandbox({ source })`** with virtual `main.ts` / `main.css` only — no Vite scaffold, SSR, or hydration in that path. See [ARROW_SANDBOX_SUBSET.md](ARROW_SANDBOX_SUBSET.md).

### Validation before save

`write_arrow_app` runs `src/lib/workspace-arrow-apps/validate-arrow-main-ts.ts`: **static rules** (no `@braian/*`, no React imports, no `onClick=`, default export must be `html`… or `component(`), then a **sandbox smoke test** (compile + mount in a hidden DOM node) when `document` exists. Invalid `main.ts` is **not written**; the model gets the error text and must fix and retry. Vitest: `validate-arrow-main-ts.test.ts`.

### Runtime errors → next model turn

`ArrowWorkspaceSandbox` reports compile/runtime failures via `sandbox-runtime-bridge.ts`. The next `buildTanStackChatTurnArgs` for that **workspace** injects a system section (**Arrow app preview errors**) so the assistant sees host feedback before replying. Entries are **consumed once** per turn build.

### Troubleshooting: QuickJS WASM / Vite

If the preview shows **`Aborted(both async and sync fetching of the wasm failed)`**, the browser could not load `emscripten-module.wasm` for QuickJS. Braian’s Vite config **excludes only** `quickjs-emscripten` and `@jitl/quickjs-wasmfile-*` from `optimizeDeps` so `import.meta.url` stays next to the real `.wasm` on disk, while **`@arrow-js/sandbox` stays pre-bundled** so its `import ts from 'typescript'` default interop works in the browser. After changing that config, delete **`node_modules/.vite`** and restart `npm run dev`.

If you see **`typescript.js` does not provide an export named `default`**, the sandbox was likely served un-optimized (e.g. `@arrow-js/sandbox` was incorrectly excluded from `optimizeDeps`); use the repo’s `vite.config.ts` and clear `.vite`.

A **`SandboxCompileError`** such as **`Declaration or statement expected`** at a line past the end of your file is almost always a **syntax error** in `main.ts` (e.g. an extra `}` or duplicated closing). Fix the file locally or use `write_arrow_app` with valid Arrow code; `write_arrow_app` rejects `@braian/*` imports and `export default function …` before save.

## Data in / out (v1)

- **In:** host reads `main.ts` / `main.css` from disk and passes them as `sandbox({ source })`.
- **Out:** sandbox calls `output(payload)`; Braian may extend handling later (e.g. persist to workspace files).

## Future: Convex

Optional Phase 2: expose **narrow** `hostBridge` methods or allowlisted HTTPS `fetch` for Convex-backed rows — **not** raw client keys inside sandbox source.

## Legacy

Older workspaces may still contain `.braian/webapp/` from the pre-Arrow template; Braian no longer runs or publishes that tree.
