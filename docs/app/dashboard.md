# Workspace dashboard and in-app pages

Braian can show a **workspace dashboard** inside the app: KPI-style tiles, markdown summaries, shortcuts to full-screen **pages** you define, and links out to the web. This is **not** a hosted public website—it is UI stored as JSON **under your workspace folder** and rendered only in Braian Desktop.

## Where you see it

- **Sidebar → Dashboard** opens the main board for the **active workspace** (`/dashboard` in the app).
- **Pages** you add appear in the sidebar under Dashboard and at URLs like `/dashboard/page/your-page-id`.

## Files on disk

Everything lives under the workspace root:

| Path | Purpose |
|------|---------|
| `.braian/dashboard/board.json` | Main dashboard layout (regions and tiles). |
| `.braian/dashboard/pages/<pageId>.json` | One full-screen in-app page per file. |

The app creates the `.braian/dashboard/` layout when needed. You can edit these files by hand or let the assistant update them when **App** mode is on (see below).

## Chat modes: Document, Code, and App

In a **saved** chat attached to a workspace (desktop app), the header has a three-part control:

| Mode | What it does |
|------|----------------|
| **Document** | Default assistant: document canvas, attachments, and “lazy” workspace tools. Dashboard builder tools stay hidden until the assistant explicitly enables them. |
| **Code** | **Code-style** assistant: read/write/list/run in the workspace are available immediately for that chat (see [Tools](/docs/tools)). |
| **App** | Same document-style assistant as **Document**, but **dashboard and page tools** are enabled for every message in that chat, and the model gets extra instructions for editing `board.json` and page JSON. |

Switch modes anytime; the choice is stored with the conversation.

**Tip:** If you only need files or scripts, use **Code**. If you want Braian to design or change tiles and in-app pages, use **App** (or stay on **Document** and ask it to enable dashboard work—it can still do that via its tools when appropriate).

## What you can put on the board

The manifest (`board.json`) uses `schemaVersion: 1` and three **regions**:

1. **`insights`** — Small KPI tiles (up to **8**). Each tile: `kind: "kpi"`, plus `id`, `label`, `value`, and optional `hint`.
2. **`links`** — Shortcuts (up to **16**): either a **page link** (`kind: "page_link"`, `pageId`, `label`, optional `description`) or an **external link** (`kind: "external_link"`, `label`, `href` with a full URL).
3. **`main`** — Larger content (up to **24**): **markdown** (`kind: "markdown"`, `body` — GitHub-flavored markdown, prose only), **kpi**, or **page_link** (same shapes as above).

Optional top-level fields: `title`, and `updatedAtMs` (usually set automatically when the assistant saves).

## Full-screen pages

Each page file uses `schemaVersion: 1`, a **`pageId`** (letters, digits, hyphens; must match the filename, e.g. `reports` → `reports.json`), `title`, optional `description`, and **`tiles`**: the same tile kinds as **`main`** on the board (up to **32** tiles).

Open a page in the app at **`/dashboard/page/<pageId>`**. Page links on the dashboard point there.

## Working with the assistant

- With **App** mode selected, ask for things like: “Add a KPI for open invoices,” “Create a page called `weekly-summary` with last week’s notes,” or “Link to our CRM in the shortcuts row.”
- The assistant should **read** the current dashboard first, then **write** the full manifest or page JSON so nothing is dropped accidentally.
- You can still maintain JSON yourself in an editor; invalid JSON or unknown tile types will not render until fixed.

## Safety and limits

- Tile content is rendered with Braian’s own components—**do not expect HTML or scripts** inside markdown to run as in a browser extension.
- Stay within the documented **`kind`** values; unknown kinds are rejected by validation.
- External links open as normal URLs; only add sites you trust.

## Related

- [Overview](/docs/overview)
- [Tools](/docs/tools)
- [Capabilities](/docs/capabilities)
