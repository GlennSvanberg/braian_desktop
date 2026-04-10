# Memory (workspace)

For the **architecture** behind these features (layers, principles, and roadmap), see [How memory works](/docs/how-memory-works).

Braian stores **durable workspace context** on disk so the assistant can reuse facts, preferences, and decisions across chats.

## Layers

1. **`.braian/MEMORY.md`** — Legacy **markdown** workspace notes. The app can append via tools or memory review; you can edit it manually. Injected into the model context when non-empty (size-capped).
2. **Structured semantic memory** — JSON records under **`.braian/memory/`** (`facts/`, `decisions/`, `preferences/`, `episodes/`, `patterns/`). This is the long-term direction; the app generates **`.braian/memory/index.md`** as a readable overview. The model receives an injected block of **active** structured entries (also size-capped).
3. **Rolling conversation summary** — **`.braian/conversation-summaries/<conversation-id>.summary.json`** holds a compact summary, **open loops**, **important decisions**, and covered message ids when chat history exceeds the **token budget** (see Settings → max chat history tokens).
4. **Full transcripts** remain in **`.braian/conversations/<id>.json`**. Recent turns are sent verbatim; older content is summarized unless recalled with tools.

## Tools (desktop)

- **`add_workspace_memory`** — Append markdown to `MEMORY.md`.
- **`remember_workspace_fact`** / **`remember_workspace_preference`** — Create structured JSON memory entries.
- **`search_workspace_memory`** / **`open_memory_entry`** — Search and open structured records.
- **`forget_memory_entry`**, **`mark_memory_stale`**, **`validate_memory_entry`** — Archive, mark stale, or validate entries.
- **`search_conversation_archive`** / **`open_conversation_span`** — Search and read older transcript messages omitted from the visible thread.
- **`get_conversation_summary`** — Read the current chat’s rolling summary JSON.
- **`search_codebase_index`** / **`get_related_files_for_memory`** — Lexical workspace search and file refs from a memory entry.

## Workspace preferences (optional)

If present, **`.braian/preferences/workspace-preferences.json`** is injected as its own system section.

Optional JSON fields:

- **`injectLegacyMemoryMd`** (boolean, default `true`) — When set to **`false`**, the legacy **`.braian/MEMORY.md`** file is **not** injected into the model (structured memory under `.braian/memory/` and other layers still apply). Use this when structured JSON memory is sufficient and you want a smaller prompt.

## Suggestion queue

After a successful **automatic or manual memory review** (markdown merge into `MEMORY.md`), the app may run a **second, small model pass** to propose structured-memory candidates. Those are stored as JSON under **`.braian/memory/_suggestions/`** for future UI review (nothing is activated without confirmation). Skipped when **mock AI** mode is enabled (`localStorage braian.mockAi`).

## Updating `MEMORY.md`

1. **Manual:** From an open chat, use **Update memory** when you want the app to refresh `MEMORY.md` from recent conversation (subject to app rules and limits).
2. **Automatic:** In **Settings**, you can turn on **Automatically update memory when I pause chatting**. When enabled, the app schedules a debounced review after you stop sending messages for a while, and respects minimum intervals.

## Related

- [Model context](/docs/model-context) — full system-section order each turn.
- [Overview](/docs/overview)
- [Tools](/docs/tools)
