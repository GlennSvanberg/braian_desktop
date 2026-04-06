# Workspace dashboard

The **Dashboard** route (`/dashboard`) is the workspace **hub**: a manifest-driven **Overview** plus the **published workspace webapp** and **app settings**. It is not the same as the full Vite mini-apps under `.braian/webapp/` — those run inside the **Apps** tab (iframe); Overview is native Braian UI.

## Tabs

| Tab | What it is |
|-----|------------|
| **Overview** | Welcome, continue chats, KPIs, workspace app shortcuts, recent files, and insights. Layout can be customized with `.braian/dashboard.json`. |
| **Apps** | The **published** build of `.braian/webapp/` (static server). |
| **App settings** | Template, dependencies, dev preview, publish. Legacy URLs `/workspace/<id>/webapp` still work. |

Opening **Dashboard** from the sidebar defaults to **Overview**.

## Files on disk (hub)

| Path | Purpose |
|------|---------|
| `.braian/dashboard.json` | Optional `schemaVersion` + ordered `sections` (`welcome`, `continue`, `apps`, `recent_files`, `kpis`, `insights` — default order packs the top row on wide layouts). |
| `.braian/webapp-apps.json` | Auto-written on **Publish**; lists `path` + `label` from `app-routes.tsx`. Overview falls back to parsing `app-routes.tsx` if this file is missing. |
| `.braian/recent-files.json` | Auto-updated when you attach/import files or save workspace files (capped list). |
| `.braian/insights.json` | Optional `items[]` with `id`, `text`, `createdAtMs` for custom insight lines on Overview. |

## Workspace webapp (Vite)

Each workspace can host a **Vite + React + TypeScript** app under **`.braian/webapp/`**, copied from Braian’s bundled template. Node.js and **npm** must be on your PATH for install and build.

| Path | Purpose |
|------|---------|
| `.braian/webapp/` | User-editable Vite project (`src/`, `package.json`, etc.). |
| `.braian/skills/app-builder/SKILL.md` | Seeded skill for App mode (legacy `app-builder.md` still read for compatibility). |

## Chat modes: Document, Code, and App

| Mode | What it does |
|------|--------------|
| **Document** | Default; coding and **webapp helper** tools are **lazy** until the assistant calls **`switch_to_code_agent`** or **`switch_to_app_builder`** and completes discovery. |
| **Code** | Eager file/shell tools. Webapp helpers stay **lazy** (use **App** or the switch for full webapp workflow). |
| **App** | Eager **code** tools plus eager **`init_workspace_webapp`** and **`read_workspace_webapp_dev_logs`**, and the **app-builder** skill text. Use this to build or edit the Vite app. |

## Working with the assistant

- Ask for UI in **`.braian/webapp/src`**. Use **`run_workspace_shell`** with `cwd: ".braian/webapp"` for **`npm install`** / **`npm run build`** — not **`npm run dev`** (Braian starts the dev server).
- Use **`read_workspace_webapp_dev_logs`** after preview or compile issues.
- Use **`init_workspace_webapp`** when the project is missing or you want a clean template (`overwrite: true` replaces files).
- Use **`publish_workspace_webapp`** so **Dashboard → Apps** shows the latest build and **webapp-apps.json** is refreshed.

## Related

- [Overview](/docs/overview)
- [Model context](/docs/model-context)
- [Tools](/docs/tools)
- [Capabilities](/docs/capabilities)
