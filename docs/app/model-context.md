# Model context (what the AI sees each turn)

Braian does not send a single blob of instructions. It builds a **structured request** for each message: several **system sections** (in a fixed order), your **chat history**, the latest **user message**, and **tools** the model may call.

In the chat toolbar, **Context** opens the **Model context** dialog: **Last sent** vs **Next preview**, summary cards showing effective state (mode, canvas, tools, etc.), grouped/collapsible raw sections, and **Copy JSON** for the full snapshot — useful when debugging prompts or skills.

## System sections (typical workspace chat)

For a normal chat attached to a **workspace folder** (not "new chat" without a folder, and not the **You** profile coach), sections are assembled in this order:

1. **Routing (Core)** — A numbered **decision tree** assembled for the current turn, plus a short addendum for **document/triage** or **code** mode, and in **App** mode an extra **App mode** subsection (workspace webapp, live preview). It tells the model how to choose webapp helpers, code tools, the document canvas, workspace skills, and MCP tools **without mentioning workflows that are unavailable in that scenario**.
2. **Skills** — A **catalog** listing every skill file's `name`, `description`, and path (metadata only). Full skill bodies — including create-skill instructions — load **on demand** via `read_workspace_skill`, keeping the default prompt compact.
3. **User context** — Your saved **profile** (sidebar → **You**) and the app's **current client time** (for tone and scheduling; the model is told not to read the clock aloud unless you ask).
4. **Workspace memory** — Excerpt from **`.braian/MEMORY.md`** when that file exists and is non-empty (subject to size limits). See [Memory](/docs/memory).
5. **This turn** — Optional blocks appended when relevant:
   - **Attached workspace files** (excerpts from @-attachments),
   - **Document canvas snapshot** (latest side-panel markdown + **revision**, optional **selection** excerpt),
   - **Workspace webapp builder** — When **App** mode is on for that chat, the app injects the full **app-builder** instructions (loaded from **`.braian/skills/app-builder.md`**, with an in-app fallback if the file is missing).

Detached chats (no workspace folder yet) and synthetic sessions skip workspace-only sections (memory, skills on disk, webapp files) where the app cannot resolve paths.

## Profile coach (**You**)

The **sidebar → You** chat uses a **separate** prompt: profile coach instructions plus your **current profile** text. It does **not** include workspace memory, skills, canvas, or workspace tools — only **`update_user_profile`** so that session stays focused on who you are and your preferences.

## Workspace skills

Skills are Markdown files under **`.braian/skills/`** in the workspace. Each file starts with YAML frontmatter (`name` and `description`), then the instruction body.

- New workspaces (or first use of `.braian`) get default **`create-skill.md`** and **`app-builder.md`** from the app so the catalog is never empty of those two.
- The model sees only the **catalog** (name + description per file) in the default prompt. It calls **`read_workspace_skill`** to load the full body when a skill is relevant.
- The model can also call **`list_workspace_skills`** and **`write_workspace_skill`** (desktop app, real workspace only) to discover and edit skills without switching to **Code** mode for generic file tools.

See [Tools](/docs/tools) for a short summary of those tools.

## Tools vs system text

- **Lazy tools** (document mode): coding and **webapp helper** tools may appear as "lazy" until the model calls the right **`switch_to_*`** tool and completes **tool discovery**. Those unlock steps are only mentioned in the prompt when the corresponding switch tool is actually available that turn. The **Context** dialog shows each tool tagged as **eager** or **lazy**.
- **Code** mode: all **coding** workspace tools are available immediately — `read_workspace_file`, `write_workspace_file`, `patch_workspace_file`, `list_workspace_dir`, `search_workspace`, `run_workspace_command`, and `run_workspace_shell`. Webapp helpers remain **lazy** until `switch_to_app_builder` + discovery. The routing addendum includes a **tool selection guide** and guidelines for search-before-read, patch-over-rewrite, and shell usage. `maxIterations` is higher (40 base, up to 48 with MCP) to accommodate the richer tool surface.
- **App** mode: same eager **coding** tools as Code mode, and **`init_workspace_webapp`** / **`read_workspace_webapp_dev_logs`** are **eager** too. The **app-builder** section (from the skill file when possible) plus the **App mode** routing subsection describe `.braian/webapp/`. `maxIterations` is slightly higher than Code-only (44 base) to cover webapp edits. See [Workspace webapp](/docs/dashboard).
- **MCP issues**: when MCP connections fail or are slow, warnings are injected into a dedicated **"Connections (MCP) issues"** system section so the model is aware of unavailable tools. Active MCP server names are listed in the routing text; configured-but-inactive servers may be listed too so the model does not assume they are callable in this chat.

## Per-chat MCP selection

Connections are now resolved in three layers:

1. **Configured** — workspace `.braian/mcp.json` (`mcpServers`)
2. **Enabled in workspace** — not listed in `braian.disabledMcpServers`
3. **Active in this chat** — selected in the chat header Connections picker

Only layer (3) is exposed as `mcp__*` tools in the current turn.

## Related

- [Overview](/docs/overview)
- [Tools](/docs/tools)
- [Connections (MCP)](/docs/mcp) — workspace `.braian/mcp.json`, injected when MCP tools are available for that workspace
- [Memory](/docs/memory)
- [Workspace webapp](/docs/dashboard)
- [Capabilities](/docs/capabilities)
