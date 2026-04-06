---
name: app-builder
description: Braian workspace webapp (Vite in .braian/webapp). Use after switch_to_app_builder and lazy tool discovery.
---

## Workspace webapp (Vite + React + TypeScript)

The interactive UI for this workspace lives under **`.braian/webapp/`** (bundled template: Vite 7, React 19, Tailwind v4, **react-router-dom**). The sidebar **Webapp** route shows the **published** production build (large iframe). **Dev preview** (hot reload) runs from **Start dev preview** on that page or from the chat **artifact** in App mode.

**Visual system:** Use **semantic Tailwind classes** from the template: `bg-app-bg-0`, `bg-app-bg-1`, `text-app-text-1`, `border-app-border`, `text-app-accent-600`, etc. (defined in **`src/index.css`**). **Do not** replace the app with plain white pages and default black text — that breaks Braian theming. The root layout **`BraianShell`** in **`src/layouts/BraianShell.tsx`** wraps all routes; keep it in **`App.tsx`**.

### Sacred landing (`/`) — entry point only

- **`/`** is **only** the **My apps** index. It is implemented as **`MyAppsLandingPage`** in **`src/app-routes.tsx`** (same file as **`APP_ROUTES`**).
- **Never** replace **`MyAppsLandingPage`** with a feature screen (forms, validators, dashboards, games, etc.). **Never** remove the **`APP_ROUTES` → `<Link>` list** — users need real navigation, not prose like “open `/foo`”.
- **Every new mini-app** — including when the user says “simple” or “just a small app” — belongs on a **sub-path** (e.g. **`/email-checker`**): add **`src/pages/<Name>Page.tsx`**, append one object to **`APP_ROUTES`** in **`app-routes.tsx`**, then call **`set_workspace_webapp_preview_path`** with **`/that-path`** (not **`/`**).
- **`App.tsx`** must keep **`<Route path="/" element={<MyAppsLandingPage />} />`**. Do not point **`/`** at feature UI.
- At most adjust **short copy** inside **`MyAppsLandingPage`**; structure and themed styling must stay.

### Multi-page app (routing)

- Each feature lives on its own path (e.g. **`/calculator`**, **`/register`**, **`/email-checker`**).
- **Do not** collapse new work into the root route or delete **`BraianShell`**.
- After you create or edit a sub-page, call **`set_workspace_webapp_preview_path`** with **that page’s path**. Use **`/`** only when the user should see the **My apps** index — not to show a feature you just built.

### Edit

- Change **`src/**`** (`App.tsx`, `app-routes.tsx`, `pages/`, `layouts/`, `index.css`). Use `read_workspace_file`, `write_workspace_file`, `patch_workspace_file`.
- Paths are relative to the **workspace root**; webapp files use prefix `.braian/webapp/...`.

### Scaffold

- If **`package.json`** is missing (or the user wants a clean template), call **`init_workspace_webapp`** (`overwrite: true` only when replacing an existing app).

### One-shot commands (not the dev server)

- Use **`run_workspace_shell`** with **`cwd: ".braian/webapp"`** for `npm install`, typecheck, etc.
- **Do not** run **`npm run dev`** via the shell tool — it is long-running. Braian starts the dev server via **Start dev preview** in the UI or the artifact panel.
- To refresh what the **sidebar** shows, call **`publish_workspace_webapp`** or ask the user to click **Publish** in Braian (runs `npm run build` with the correct `--base` for the static server). Until then, **unpublished** source edits are not what the sidebar iframe shows.

### Published app vs dev preview

- **Publish** (tool or UI) updates **`dist/`** and the sidebar **Webapp** iframe. The UI shows when there are **unpublished changes** compared to the last publish.
- **Dev preview** is for editing: **Start dev preview** / **Stop dev preview**. The **Preview path** field and **`set_workspace_webapp_preview_path`** apply to **both** published and dev URLs.
- To inspect dev server output after a start failure or runtime errors, call **`read_workspace_webapp_dev_logs`** (ring buffer from the managed dev process).

### Troubleshooting

- **`Cannot find name 'process'`** in **`vite.config.ts`** during **`tsc -b`**: run **`npm i -D @types/node`** in **`.braian/webapp`** (the bundled template includes it; older copies may not).
- **`publish_workspace_webapp`** (or **`npm run build`** via shell) surfaces compile errors in the returned log.
- **`read_workspace_webapp_dev_logs`** for Vite/npm messages from the dev preview process.
- Ensure **`npm install`** completed successfully before **Publish** or dev preview.
