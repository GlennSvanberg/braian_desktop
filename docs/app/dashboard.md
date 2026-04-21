# Workspace dashboard

The **Dashboard** route (`/dashboard`) is the workspace **hub**: a manifest-driven **Overview** plus **Arrow workspace apps** and **app settings**. The **Apps** tab runs each app in an **Arrow JS** sandbox (no Vite iframe).

## Tabs

| Tab | What it is |
|-----|------------|
| **Overview** | Welcome, continue chats, KPIs, workspace app shortcuts, recent files, and insights. Layout can be customized with `.braian/dashboard.json`. |
| **Apps** | Live preview of the selected **Arrow** app from `.braian/arrow-apps/`. |
| **App settings** | Notes and preview for Arrow apps. Legacy URLs `/workspace/<id>/webapp` still open this area. |

Opening **Dashboard** from the sidebar defaults to **Overview**.

## Files on disk (hub)

| Path | Purpose |
|------|---------|
| `.braian/dashboard.json` | Optional `schemaVersion` + ordered `sections` (`welcome`, `continue`, `apps`, `recent_files`, `kpis`, `insights` — default order packs the top row on wide layouts). |
| `.braian/arrow-apps.json` | Index: `activeAppId`, `apps[]` with `id`, `title`, `updatedAtMs`. Drives **Overview** app shortcuts and **Apps** tab. |
| `.braian/arrow-apps/<appId>/` | Per-app `main.ts` (required), optional `main.css`, optional `manifest.json`. |
| `.braian/recent-files.json` | Auto-updated when you attach/import files or save workspace files (capped list). |
| `.braian/insights.json` | Optional `items[]` with `id`, `text`, `createdAtMs` for custom insight lines on Overview. |

## Workspace Arrow apps

Interactive UI is authored as **Arrow** templates executed in a **QuickJS/WASM** sandbox (`@arrow-js/sandbox`). See [Arrow JS](https://arrow-js.com/) and the bundled **app-builder** skill (`.braian/skills/app-builder/SKILL.md`).

## Chat modes: Document, Code, and App

| Mode | What it does |
|------|--------------|
| **Document** | Default; coding and **Arrow app** tools are **lazy** until the assistant calls **`switch_to_code_agent`** or **`switch_to_app_builder`** and completes discovery. |
| **Code** | Eager file/shell tools. Arrow app tools stay **lazy** until **App** or **`switch_to_app_builder`**. |
| **App** | Eager **code** tools plus eager **Arrow app** tools (`list_arrow_apps`, `read_arrow_app`, `write_arrow_app`, `delete_arrow_app`, `set_active_arrow_app`) and the **app-builder** skill text. |

## Working with the assistant

- Use **`write_arrow_app`** to create or update an app (`appId`, `title`, `mainTs`, optional `mainCss`).
- Use **`set_active_arrow_app`** so **Dashboard → Apps** and the App-mode artifact open the right app.
- Use **`list_arrow_apps`** / **`read_arrow_app`** before larger edits.

## Related

- [Overview](/docs/overview)
- [Model context](/docs/model-context)
- [Tools](/docs/tools)
- [Capabilities](/docs/capabilities)
- Maintainer: [ARROW_APPS.md](../ARROW_APPS.md)
