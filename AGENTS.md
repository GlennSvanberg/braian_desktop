# AGENTS.md — Braian Desktop

Instructions for coding agents working in this repository.

## Product direction

Braian Desktop is a **local-first**, **chat-first** AI workspace that will grow into an **artifact / dashboard**-centric UI (see [`NOTES.md`](NOTES.md)). The web tech stack runs inside a **Tauri** shell with access to the filesystem and a local **SQLite** database.

## Tech stack

| Layer | Choice |
|--------|--------|
| Desktop shell | **Tauri 2** (`src-tauri/`, Rust) |
| UI | **React 19** + **TanStack Start** + **TanStack Router** (file routes under `src/routes/`) |
| Styling | **Tailwind CSS v4** + **single global stylesheet** [`src/styles/app.css`](src/styles/app.css) |
| Components | **shadcn/ui** (Radix primitives), see [`components.json`](components.json) |
| Local DB | **SQLite** via **`rusqlite`** in Rust; DB file `braian.db` under the app data directory, initialized on startup (`_schema_version` table + `SELECT 1` sanity check) |
| LLM / tools (TS) | **[TanStack AI](https://tanstack.com/ai/latest)** — multi-provider, BYOK-oriented integration; see [`docs/AI.md`](docs/AI.md) for decisions and caveats (library is **alpha**) |

There is **no** Convex/cloud backend in this repo yet.

## AI integration

- **Rationale and alternatives:** [`docs/AI.md`](docs/AI.md).
- **TanStack AI usage (skill):** Install `tanstack-skills/tanstack-skills@tanstack-ai` via `npx skills add …` — see [`docs/AI.md`](docs/AI.md#agent-skill-usage-patterns) for the exact command and skills.sh link.
- **Execution boundary:** Prefer **Tauri commands** (and later MCP) for filesystem and shell-like actions; keep paths scoped to the user’s workspace. The model can use a shell-**shaped** tool that is **implemented** in Rust, not arbitrary webview shell access.
- **UI contract:** Real adapters should preserve artifact/stream chunk shapes used by the workspace panel (`src/lib/ai/types.ts`, `src/lib/artifacts/`).

## Commands

- **Web only (browser):** `npm run dev` — Vite on port **3000** (`strictPort`).
- **Desktop:** `npm run tauri:dev` (or `npx tauri dev`) — runs `beforeDevCommand` (`npm run dev`) and opens the WebView to `http://localhost:3000`.
- **Production web build:** `npm run build` — static client assets for Tauri live in **`dist/client/`** (`src-tauri/tauri.conf.json` → `build.frontendDist`). (Some TanStack Start versions emit `.output/public` instead; if you upgrade and the path changes, update `frontendDist` to match.)
- **Desktop release build:** `npm run tauri:build`.
- **Tests:** `npm run test` (Vitest). **Headless AI evaluation** (`ai:dump`, `ai:stream`) and how they map to manual QA live in [`TESTING.md`](TESTING.md); chat scenarios are listed in [`testcases.md`](testcases.md).

## Styling contract

- **Do not** scatter arbitrary hex colors in TSX.
- **Do** define and consume tokens in [`src/styles/app.css`](src/styles/app.css). Human-readable tables and theme notes: [`docs/STYLING.md`](docs/STYLING.md).

## Repository layout

- `src/routes/` — file-based routes (`__root.tsx`, `index.tsx`, …)
- `src/components/` — app UI; `src/components/ui/` — shadcn primitives
- `src/lib/` — shared TS utilities (`cn`, etc.)
- `src/styles/app.css` — **only** global CSS entry (imported from `__root.tsx`)
- `src-tauri/src/` — Rust entry (`lib.rs`, commands, plugins)

## SQLite notes

- Opening and migration scaffolding live in **`src-tauri`** (`rusqlite`, bundled SQLite).
- If most data access should move to the frontend later, consider **`@tauri-apps/plugin-sql`**; for now the DB is validated from Rust only.

## Reference projects

- Earlier web prototype (colors only, for history): `C:\git\glenn\braian\`
- Tauri + TanStack Start pattern inspiration: [kvnxiao/tauri-tanstack-start-react-template](https://github.com/kvnxiao/tauri-tanstack-start-react-template)
