# Model context (what the AI sees each turn)

Braian does not send a single blob of instructions. It builds a **structured request** for each message: several **system sections** (in a fixed order), your **chat history**, the latest **user message**, and **tools** the model may call.

In the chat toolbar, **Context** opens the **Model context** dialog: **Last sent** vs **Next preview**, summary cards showing effective state (mode, canvas, tools, etc.), grouped/collapsible raw sections, and **Copy JSON** for the full snapshot — useful when debugging prompts or skills.

## System sections (typical workspace chat)

For a normal chat attached to a **workspace folder** (not "new chat" without a folder, and not the **You** profile coach), sections are assembled in this order:

1. **Routing (Core)** — A numbered **decision tree** for the current turn, plus a short addendum for **document/triage** or **code** mode, and in **App** mode an extra **App mode** subsection (workspace webapp, live preview).
2. **Skills** — A **catalog** listing every skill's `name`, `description`, and main path (usually `.braian/skills/<slug>/SKILL.md`) as metadata only. Full skill bodies load **on demand** via `read_workspace_skill`.
3. **User context** — Your saved **profile** (sidebar → **You**) and the app's **current client time**.
4. **Workspace preferences** (if the file exists) — **`.braian/preferences/workspace-preferences.json`**. JSON may include **`injectLegacyMemoryMd: false`** to omit legacy **`.braian/MEMORY.md`** from the prompt.
5. **Workspace instructions** — Root **`AGENTS.md`** when present (size-capped).
6. **Earlier conversation (summary)** / **Important decisions** / **Open loops** — From the rolling **`.braian/conversation-summaries/<id>.summary.json`** when history is token-trimmed or the file has content; includes **important decisions** extracted during compaction.
7. **Structured workspace memory** — Active entries from **`.braian/memory/**/*.json`** (generated overview: `.braian/memory/index.md`).
8. **Workspace memory (`MEMORY.md`)** — Legacy markdown notes from **`.braian/MEMORY.md`** when non-empty.
9. **Full transcript** — Pointer to **`.braian/conversations/<id>.json`** and tools to search older messages (`search_conversation_archive`, `open_conversation_span`, `get_conversation_summary`).
10. **This turn** — Optional blocks when relevant:
   - **Attached workspace files** (excerpts from @-attachments),
   - **Prior conversations** (attached),
   - **Document canvas snapshot** (latest side-panel markdown + **revision**, optional **selection** excerpt),
   - **Workspace webapp builder** — When **App** mode is on, app-builder instructions from **`.braian/skills/app-builder/SKILL.md`** (with fallbacks).

Detached chats (no workspace folder yet) and synthetic sessions skip workspace-only sections where the app cannot resolve paths.

## Chat history token budget

Settings include **max chat history tokens**. When the full thread would exceed that budget, older turns are **folded** into the rolling summary file; only a **suffix** of recent messages is sent as chat history. Use archive tools to retrieve older verbatim content.

## Profile coach (**You**)

The **sidebar → You** chat uses a **separate** prompt: profile coach instructions plus your **current profile** text. It does **not** include workspace memory, skills on disk, canvas, or workspace tools — only **`update_user_profile`**.

## Tools vs system text

- **Eager tools** (always registered in workspace chats): canvas helpers, **`add_workspace_memory`**, structured memory tools (`remember_workspace_*`, `search_workspace_memory`, …), **conversation archive** tools (`search_conversation_archive`, `open_conversation_span`, `get_conversation_summary`), **`search_codebase_index`**, **`get_related_files_for_memory`**, and provider web search when configured.
- **Lazy tools** (document mode): coding and **webapp helper** tools may appear as "lazy" until the model calls **`switch_to_*`** and completes **tool discovery**.
- **Code** mode: workspace file tools are eager; webapp helpers may stay lazy until `switch_to_app_builder` + discovery.
- **MCP issues**: when MCP connections fail, warnings appear in a **Connections (MCP) issues** section.

## Per-chat MCP selection

1. **Configured** — workspace `.braian/mcp.json` (`mcpServers`)
2. **Enabled in workspace** — not listed in `braian.disabledMcpServers`
3. **Active in this chat** — selected in the chat header Connections picker

Only layer (3) is exposed as `mcp__*` tools in the current turn.

## Related

- [Overview](/docs/overview)
- [Memory](/docs/memory)
- [Tools](/docs/tools)
- [Connections (MCP)](/docs/mcp)
