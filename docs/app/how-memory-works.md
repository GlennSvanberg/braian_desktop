# How memory works

Braian is **local-first**: memory is stored on disk inside your workspace, not only inside the current chat window. The assistant reuses facts, preferences, and decisions over time, while keeping each model turn small enough to stay fast and coherent.

This page explains the **layered memory model** (why there is more than one kind of “memory”), where data lives, and how that maps to what is **implemented today** versus what is still on the roadmap. For day-to-day tools and file paths, see [Memory](/docs/memory). For the exact order of prompt sections each turn, see [Model context](/docs/model-context).

## Why layered memory?

Different jobs need different storage:

- **Stable instructions** (how you want the agent to behave in this repo) are not the same as **conversation working state** (what you are doing right now).
- **Facts and decisions** you want to reuse next month should be **structured and provenance-aware**, not a single growing paragraph.
- **Code awareness** should come from **search and indexes** over files, not from pasting whole trees into the prompt every turn.

So Braian treats memory as **several layers** that work together, not one monolithic file.

## The layers

### 1. Instruction memory

Stable guidance for the workspace. The primary file is `**AGENTS.md`** at the workspace root (compatible with other coding agents). Braian reads it when present and injects a size-capped block into context. Braian does **not** silently rewrite `AGENTS.md`; changes belong in your editor or explicit proposals.

### 2. Short-term (working) conversation memory

Active chats use a **token-budgeted** mix of:

- **Recent messages** sent verbatim, up to your **max chat history tokens** (Settings).
- A **rolling summary** plus **open loops** and **important decisions** in `**.braian/conversation-summaries/<conversation-id>.summary.json`** when older turns are folded out of the hot set.
- A pointer to the **full transcript** on disk (`**.braian/conversations/<id>.json`**) plus tools to search or open older spans.

The goal is to avoid replaying the **entire** thread every turn while still allowing the model to **retrieve** older detail when needed.

### 3. Long-term semantic memory

Durable, reusable knowledge lives as **structured JSON** under `**.braian/memory/`** (for example `facts/`, `decisions/`, `preferences/`, `episodes/`, `patterns/`). Each record can include provenance, confidence, status, and links to sources. The app also maintains `**.braian/memory/index.md**` as a human-readable overview.

`**.braian/MEMORY.md**` remains a **legacy markdown** surface: it can still be updated by tools and memory review, and is injected during transition; structured JSON is the long-term direction for durable memory.

### 4. Codebase memory

A **retrieval layer** over the workspace: searchable chunks and paths, not a second copy of your repo inside “prompt memory.” Today this includes **lexical** search and helpers that relate memory entries to files; richer hybrid (embedding + symbol) indexing is planned.

### 5. Preference memory

**Explicit** preferences and corrections—scoped globally, per workspace, or per session where supported. Workspace defaults can live in `**.braian/preferences/workspace-preferences.json`** (for example opting out of injecting legacy `**MEMORY.md**` when you no longer need it).

## Design principles

- **Hot memory stays small** — Only a compact, high-value subset is injected every turn; the rest is reachable via tools and retrieval.
- **Files are canonical; indexes are derived** — Transcripts, summaries, and memory records are files you can inspect, back up, or version; SQLite and indexes can be rebuilt from them.
- **Provenance** — Durable entries should know where they came from (conversation, file, tool run) so you can trust, validate, or retire them.
- **Conservative promotion** — Prefer explicit “remember” actions and reviewable suggestions over silently memorizing everything.

## Canonical layout (under `.braian/`)

Typical locations (not every file exists until used):


| Area                      | Role                                             |
| ------------------------- | ------------------------------------------------ |
| `conversations/`          | Full transcript JSON per chat                    |
| `conversation-summaries/` | Rolling summary, open loops, important decisions |
| `memory/`                 | Structured JSON records + `index.md`             |
| `preferences/`            | Workspace preference JSON                        |
| `retrieval/`              | Derived index state (when used)                  |


The app may also use a **SQLite** database under the application data directory for **derived** indexes (for example faster memory lookup), without replacing the files as the readable source of truth.

## Behavior today vs roadmap

The product evolves incrementally. In broad strokes:

- **In place:** `AGENTS.md` loading; token-budgeted history with rolling summaries; structured semantic memory files and tools; conversation archive and summary tools; optional workspace preferences injection; lexical codebase search helpers tied to memory; SQLite indexing for memory entries; optional post–memory-review **suggestion** queue for future structured entries.
- **Still maturing:** Full memory management UI (browse, edit, validate, suggestion review), stronger staleness and validation automation, and a full hybrid codebase index (embeddings + symbols) as described in the engineering plan.

For the full phased implementation notes and open questions, see `**MEMORY_PLAN.md`** in the repository root (contributor-facing).

## Related

- [Memory](/docs/memory) — tools, files, and settings
- [Model context](/docs/model-context) — system section order each turn
- [Tools](/docs/tools) — workspace and memory-related tools