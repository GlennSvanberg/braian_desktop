# Model context (what the AI sees each turn)

Braian does not send a single blob of instructions. It builds a **structured request** for each message: several **system sections** (in a fixed order), your **chat history**, the latest **user message**, and **tools** the model may call.

In the chat toolbar, **Context** opens the **Model context** dialog: **Last sent** vs **Next preview**, a short guide to **how sections are ordered**, group labels (Core, Skills, User, …), and **Copy JSON** for the full snapshot—useful when debugging prompts or skills.

## System sections (typical workspace chat)

For a normal chat attached to a **workspace folder** (not “new chat” without a folder, and not the **You** profile coach), sections are assembled in this order:

1. **Routing (Core)** — A numbered **decision tree** shared by all modes, plus a short addendum for **document/triage** or **code** mode. It tells the model how to choose dashboard tools, code tools, the document canvas, and workspace skills.
2. **Skills** — The **create-skill** instructions (always included so the model knows how to author `.braian/skills/*.md`), and a **catalog** listing every skill file’s `name`, `description`, and path (metadata only; full bodies load on demand).
3. **User context** — Your saved **profile** (sidebar → **You**) and the app’s **current client time** (for tone and scheduling; the model is told not to read the clock aloud unless you ask).
4. **Workspace memory** — Excerpt from **`.braian/MEMORY.md`** when that file exists and is non-empty (subject to size limits). See [Memory](/docs/memory).
5. **This turn** — Optional blocks appended when relevant:
   - **Attached workspace files** (excerpts from @-attachments),
   - **Document canvas snapshot** (latest side-panel markdown for this conversation),
   - **Workspace dashboard builder** — When **App** mode is on for that chat, the app injects the full **app-builder** instructions (loaded from **`.braian/skills/app-builder.md`**, with an in-app fallback if the file is missing).

Detached chats (no workspace folder yet) and synthetic sessions skip workspace-only sections (memory, skills on disk, dashboard files) where the app cannot resolve paths.

## Profile coach (**You**)

The **sidebar → You** chat uses a **separate** prompt: profile coach instructions plus your **current profile** text. It does **not** include workspace memory, skills, canvas, or workspace tools—only **`update_user_profile`** so that session stays focused on who you are and your preferences.

## Workspace skills

Skills are Markdown files under **`.braian/skills/`** in the workspace. Each file starts with YAML frontmatter (`name` and `description`), then the instruction body.

- New workspaces (or first use of `.braian`) get default **`create-skill.md`** and **`app-builder.md`** from the app so the catalog is never empty of those two.
- The model can call **`list_workspace_skills`**, **`read_workspace_skill`**, and **`write_workspace_skill`** (desktop app, real workspace only) to discover and edit skills without switching to **Code** mode for generic file tools.

See [Tools](/docs/tools) for a short summary of those tools.

## Tools vs system text

- **Lazy tools** (document mode): coding and dashboard tools may appear as “lazy” until the model calls the right **`switch_to_*`** tool and completes **tool discovery**—the routing section explains this.
- **Code** mode: workspace file/command tools are available immediately for that chat.
- **App** mode: dashboard tools are eager; detailed JSON schema for tiles and pages is reinforced via the **app-builder** section (from the skill file when possible). See [Dashboard & in-app pages](/docs/dashboard).

## Related

- [Overview](/docs/overview)
- [Tools](/docs/tools)
- [Connections (MCP)](/docs/mcp) — workspace `.braian/mcp.json` (not yet merged into this prompt pipeline)
- [Memory](/docs/memory)
- [Dashboard & in-app pages](/docs/dashboard)
- [Capabilities](/docs/capabilities)
