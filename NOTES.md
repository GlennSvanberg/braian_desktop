Gemini said
This summary is designed to be saved as NOTES.md in your project root to provide the LLM with the necessary architectural guardrails and vision for Braian Desktop.

Braian Desktop: Technical Vision & Context
1. The Core Vision: "The Invisible Employee"
Braian Desktop is a local-first, AI-native operational hub for business users. Unlike standard AI chat interfaces (like ChatGPT) or coding-centric IDEs (like Cursor), Braian is a Claude Artifacts-inspired workspace that prioritizes doing over talking.

The goal is to shift the primary interface from a linear chat to a persistent, interactive Artifact (Dashboard). Braian doesn't just suggest code; it reads local business data (Excel, CSV, SQL), generates scripts to manipulate that data, and renders real-time dashboards where users can take direct actions.

2. Architectural Principles
To ensure high performance, deep privacy, and future scalability, the project follows these rules:

Local-First, Sync-Later: All data resides on the user's machine. Cloud sync (Convex) is a future layer; the MVP is entirely local.

Artifact-Centric UI: The chat is a side-tool used to manipulate the "Canvas" (the Artifact/Dashboard).

Agentic Execution: Braian uses MCP (Model Context Protocol) to execute "Skills"—local scripts or tools that interact with the file system.

Abstraction for Business: Technical terms (RAG, LLM, Embeddings) are hidden. The user sees "Skills," "Dashboards," and "Actions."

File-backed workspace data (directional): Prefer storing conversations and artifacts as structured files inside the workspace over stuffing everything into SQLite—better for Git history, manual inspection, troubleshooting, and agent tooling (see sections 6 and 7).

Workspace canvas (starter surfaces): The right-hand panel is labeled **Workspace** in the UI (not "artifact"). Three first-class canvas types match what Braian is for — local data, long-form work, and visuals:

1. **Document** — Long-form text beside chat (ChatGPT Canvas–style): specs, briefs, memos. Model/tool output uses `kind: "document"` with a `body` string (plain text today; Markdown later).
2. **Data** — Tabular views for Excel/CSV-style rows. Model output uses `kind: "tabular"` with `columns[]` (`id`, `label`, optional `type`) and `rows[]` (objects keyed by column `id`). Optional `sourceLabel` for the linked file name.
3. **Visual** — Image generation previews. Model output uses `kind: "visual"` with optional `prompt`, `imageSrc` (URL or `data:image/...;base64,...`), and `alt`. Until generation is wired, the UI shows a placeholder frame.

TypeScript definitions for the discriminated union live in `src/lib/artifacts/types.ts`. The mock chat stream emits `{ type: "artifact", payload }` chunks (`src/lib/ai/types.ts`); a real adapter should do the same so the store and `ArtifactPanel` stay unchanged.

Mock sidebar conversations set `canvasKind` on each row in `src/lib/mock-workspace-data.ts` so **each saved chat** opens a different canvas (document vs data vs visual) when the thread is still empty; sending a message refreshes that payload.

3. Technical Stack
Framework: Tauri (Rust backend for secure, deep file access; React frontend).

Frontend: TanStack Start (for type-safe routing and state-driven rendering).

State/Database: SQLite today for app bootstrap and a small amount of metadata; **planned direction** is to keep most user-owned data as files inside the workspace (see section 7) so it versions cleanly with Git and stays inspectable. SQLite may remain for indexes, settings, or secrets—not as the primary store for every message and artifact.

Connectivity: MCP (Model Context Protocol) sidecars for extensible skills (e.g., local Excel reader, terminal executor).

Rendering: Shadcn/ui + TanStack Table/Charts for high-quality, interactive Artifacts.

4. Phase 1 Scope (The MVP)
The immediate goal is to build the "Excel-to-Dashboard" pipeline:

File Watcher: A Tauri-based watcher that monitors a local Excel/CSV file.

The Bridge: A Rust command that parses the local file into a clean JSON structure.

The Artifact: A reactive React dashboard that displays this data in a virtualized table/chart.

The Skill Loop: A basic "Find/Replace" agent that can modify local text files based on user requests within the chat.

Local State: Persisting the dashboard configuration so it remains available across app restarts (today often SQLite; align long-term with file-based workspace layout in section 7).

5. Development Guidelines for Cursor
Sync-Ready Data: Use UUIDs and timestamps for all database entries to ensure future cloud synchronization doesn't cause conflicts.

Actionable Code: Favor creating scripts that can be executed via the Tauri shell over providing raw code snippets in the chat.

Component Modularity: Build dashboard widgets as highly modular, state-driven React components that can be easily rearranged by the AI.

Current Focus: Implementing the Tauri + TanStack Start foundation with local file system read/write capabilities.

6. Versioning & workspace history (plan / investigation)

- **Product need:** Users (and agents) should be able to see what changed over time, roll back mistakes, and optionally share or back up a workspace without a proprietary dump format.
- **Git per workspace:** Treat each Braian **workspace** as a folder on disk that *may* be a Git repository (initialize on first save or when the user opts in). Commits could snapshot conversation files, artifact JSON, linked data paths, and workspace config—subject to `.gitignore` for secrets, API keys, and large binaries.
- **GitHub (or any remote):** Investigate optional `git remote add` + push/pull so a workspace can sync to GitHub for backup, collaboration, or CI. Consider friction: auth (PAT, SSH), LFS for big files, and clear UX so we never commit credentials.
- **App-level versioning:** Even without Git, define a **schema version** for on-disk formats (conversations JSON, artifact JSON, workspace manifest) so migrations stay explicit—similar spirit to `_schema_version` in SQLite today, but for files.
- **Open questions:** One repo per workspace vs. monorepo-style multi-root; default branch naming; whether the app runs `git` via bundled binary vs. system Git; conflict resolution when sync and local edits diverge.

7. File-first persistence (plan)

**Motivation:** Packing chats, artifacts, and dashboards into SQLite makes debugging and agent access harder: you cannot `grep` the DB from outside the app, and tools expect paths. Moving **durable user content** into the workspace as files improves transparency, Git integration (section 6), and lets an agent read prior threads by opening a folder.

- **Conversations:** Store each thread as a JSON (or JSONL) file under a convention such as `workspace/.braian/conversations/<id>.json` (exact layout TBD). Payload: ordered messages with roles, timestamps, optional tool calls, and references to artifact IDs. Human- and machine-readable; easy to diff in Git.
- **Artifacts:** Persist artifact state as JSON next to or under the same tree (e.g. `.../artifacts/<id>.json`) matching or mirroring the discriminated union in `src/lib/artifacts/types.ts` so the UI and filesystem stay aligned.
- **What stays out of “heavy” DB use:** Prefer files for anything the user would reasonably want to version, export, or hand-edit. Reserve SQLite (or a tiny manifest) for **app preferences**, **recent workspace list**, **encryption keys**, or **search indexes** if we need fast queries without scanning every file on startup.
- **Migration path:** When implementing, add export/import from current SQLite prototypes so nothing is trapped in the old shape.

8. Alignment with principles

- **Local-first** is unchanged; files on disk are the most local representation.
- **Sync-later:** Git remotes are an optional sync layer; file formats should stay merge-friendly where possible (append-only JSONL for messages is one option to reduce conflict pain).
- **Agentic execution:** Agents and MCP tools can list/read conversation and artifact files with normal path tools, which matches how coding agents already work.