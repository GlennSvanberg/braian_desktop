---
name: app-builder
description: Braian workspace webapp (Vite in .braian/webapp). Use after switch_to_app_builder and lazy tool discovery.
---

## Workspace webapp (Vite + React + TypeScript)

The interactive UI for this workspace lives under **`.braian/webapp/`** (bundled template: Vite 7, React 19, Tailwind v4, **react-router-dom**). The user previews it in the chat **artifact** (App mode) and in the sidebar **Webapp** route.

### Multi-page app (important)

- **One Vite app, many routes.** **`/`** is the **My apps** landing (links to sub-apps). Each feature lives on its own path (e.g. **`/calculator`**).
- Add page components under **`src/pages/`**, register the route in **`src/app-routes.tsx`** (single source of truth for both the router and landing links), and wire **`App.tsx`** if you add a new route file.
- When the user asks for a **new** small app or screen, **add a route and page** — **do not** replace the whole **`App.tsx`** tree with only that screen.
- After you create or edit a sub-page, call **`set_workspace_webapp_preview_path`** with that path (e.g. `/calculator`) so the Braian preview iframe opens the right page. Use **`/`** for the landing page.

### Edit

- Change **`src/**`** (`App.tsx`, `app-routes.tsx`, `pages/`, `index.css`). Use `read_workspace_file`, `write_workspace_file`, `patch_workspace_file`.
- Paths are relative to the **workspace root**; webapp files use prefix `.braian/webapp/...`.

### Scaffold

- If **`package.json`** is missing (or the user wants a clean template), call **`init_workspace_webapp`** (`overwrite: true` only when replacing an existing app).

### One-shot commands (not the dev server)

- Use **`run_workspace_shell`** with **`cwd: ".braian/webapp"`** for `npm install`, `npm run build`, typecheck, etc.
- **Do not** run **`npm run dev`** via the shell tool — it is long-running. Braian starts the dev server via **Start preview** in the UI or the same controls in the artifact panel.

### Dev server and preview

- The user (or you, by asking them) uses **Start preview** in Braian so the iframe loads the dev server. The **Preview path** field (and **`set_workspace_webapp_preview_path`**) choose which client route is shown (e.g. `/calculator`). After you change source files, Vite hot-reloads; if the iframe looks stale, the user can **Stop** then **Start** preview again.
- To inspect server output after a start failure or runtime errors, call **`read_workspace_webapp_dev_logs`** (ring buffer from the managed dev process).

### Troubleshooting

- **`npm run build`** in `.braian/webapp` surfaces compile errors in shell output.
- **`read_workspace_webapp_dev_logs`** for Vite/npm messages from the preview process.
- Ensure **`npm install`** completed successfully before starting preview.
