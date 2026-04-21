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

## Data in / out (v1)

- **In:** host reads `main.ts` / `main.css` from disk and passes them as `sandbox({ source })`.
- **Out:** sandbox calls `output(payload)`; Braian may extend handling later (e.g. persist to workspace files).

## Future: Convex

Optional Phase 2: expose **narrow** `hostBridge` methods or allowlisted HTTPS `fetch` for Convex-backed rows — **not** raw client keys inside sandbox source.

## Legacy

Older workspaces may still contain `.braian/webapp/` from the pre-Arrow template; Braian no longer runs or publishes that tree.
