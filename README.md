# Braian Desktop

**Braian Desktop** is a **local-first**, **chat-first** AI workspace built as a **Tauri 2** desktop app. The UI is React 19 with TanStack Start / TanStack Router, Tailwind CSS v4, and shadcn/ui. A local **SQLite** database (`braian.db` in the app data directory) is initialized from the Rust side on startup.

The product direction is an artifact- and workspace-centric experience: chat drives a persistent **Workspace** panel (documents, tabular data, visuals) over local files and business-style workflows—not a generic web demo. See **[NOTES.md](NOTES.md)** for vision, **[docs/AI.md](docs/AI.md)** for the **TanStack AI** LLM layer (decisions, BYOK, tools), and **[AGENTS.md](AGENTS.md)** for agent-oriented repo conventions.

## Prerequisites

- [Node.js](https://nodejs.org/) (LTS recommended)
- [Rust](https://www.rust-lang.org/) and Tauri’s [system dependencies](https://v2.tauri.app/start/prerequisites/) for your OS

## Commands

Install dependencies once:

```bash
npm install
```

| Command | What it does |
|--------|----------------|
| `npm run tauri:dev` | **Recommended for day-to-day work.** Runs the **real desktop app**: starts the Vite dev server and opens the Tauri window. Native **folder and filesystem access** (and other Tauri plugins) work here; they do **not** in the browser alone. |
| `npm run dev` | **Web only** — Vite on [http://localhost:3000](http://localhost:3000). Useful for quick UI iteration; **no** Tauri shell, so treat native APIs as unavailable. |
| `npm run build` | Production build of the frontend; static output is consumed by Tauri (`dist/client/` — see `src-tauri/tauri.conf.json` if paths change after upgrades). |
| `npm run tauri:build` | Release **desktop** bundle (installer / binary per platform). |
| `npm run preview` | Preview the built web assets locally. |
| `npm run test` | Run [Vitest](https://vitest.dev/) tests. |

## Project layout

- `src/routes/` — file-based routes
- `src/components/` — app UI (`src/components/ui/` — shadcn primitives)
- `src/lib/` — shared TypeScript utilities
- `src/styles/app.css` — global stylesheet entry (design tokens; see **[docs/STYLING.md](docs/STYLING.md)**)
- `src-tauri/` — Rust entry, Tauri commands, SQLite setup

## Learn more

- [TanStack Start](https://tanstack.com/start) / [TanStack Router](https://tanstack.com/router) / [TanStack AI](https://tanstack.com/ai/latest) (LLM integration; see [docs/AI.md](docs/AI.md))
- [Tauri v2](https://v2.tauri.app/)
