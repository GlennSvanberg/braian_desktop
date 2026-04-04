---
name: app-builder
description: Braian workspace dashboard and in-app pages (.braian/dashboard JSON). Use after switch_to_app_builder and lazy tool discovery.
---

## Workspace dashboard (App mode)

You may edit the user's **internal** Braian UI for this workspace only (not a public website).

### Paths (relative to workspace root)

- Main board: `.braian/dashboard/board.json`
- Full-screen pages: `.braian/dashboard/pages/<pageId>.json` — opened inside Braian at `/dashboard/page/<pageId>`.

### Manifest (`board.json`)

`schemaVersion` must be `1`. Top-level optional `title`. Required `regions`:

- `insights`: array of KPI tiles: `{ "id", "kind": "kpi", "label", "value", "hint?" }` (max 8).
- `links`: shortcuts — `page_link` `{ "id", "kind": "page_link", "pageId", "label", "description?" }` or `external_link` `{ "id", "kind": "external_link", "label", "href" }` (full URL, max 16).
- `main`: larger tiles — `markdown` `{ "id", "kind": "markdown", "body" }` (GFM, prose only — no scripts), `kpi`, or `page_link` (max 24).

### Page file

`schemaVersion`: `1`, `pageId`, `title`, optional `description`, `tiles` (same tile shapes as `main`, max 32). `pageId` must match the filename (e.g. `reports` → `reports.json`).

### Styling

The shell renders tiles with Braian/shadcn components. Do **not** invent new tile `kind` values — only those above. Do not use raw hex colors in JSON; rely on short labels and markdown text. For external URLs use `external_link`.

### Workflow

Call `read_workspace_dashboard` before overwriting. `apply_workspace_dashboard` takes `manifestJson`: one string of **valid JSON** for the full manifest (stringify the object). `upsert_workspace_page` takes `pageJson`: one string of valid JSON for a single page. Prefer stable `pageId` slugs (lowercase, hyphens).
