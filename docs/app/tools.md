The model only has the abilities the app gives it through **tools**. If it has not called a tool, it has not read a file, run a command, or updated the canvas—regardless of what it says.

How instructions and tool lists are combined each turn—including **routing**, **skills**, and **user profile**—is described in [Model context](/docs/model-context).

**Workspace MCP connections** (sidebar **Connections**, file `.braian/mcp.json`) are **not** the same as these built-in tools: they configure external MCP servers for future integration and for **status checks** today. See [Connections (MCP)](/docs/mcp).

## Document canvas (`open_document_canvas`)

When your chat is **saved**, the assistant can write the **document canvas** (side panel markdown) to disk and refresh the UI. It should send the **full** document content each time, merging your latest edits with what you asked for.

Use the canvas for readable drafts and reports. **Binary files** (for example `.xlsx`) belong on disk via scripts, not inside the canvas.

## Workspace file and command tools

When **code-style** workspace tools are enabled, the assistant can:

| Tool | What it does |
|------|----------------|
| `read_workspace_file` | Read a UTF-8 text file under the workspace (fails on binary-only content). |
| `write_workspace_file` | Create or overwrite a UTF-8 file; parent folders are created as needed. |
| `list_workspace_dir` | List files and folders in one directory (not recursive). |
| `run_workspace_command` | Run a program with arguments (**no interactive shell**). Stdout and stderr are captured; very large output may be truncated. |

Paths are always **relative to the workspace root**. On Windows, follow the app’s guidance for running Python or PowerShell (separate arguments, not a single shell string).

## Chat mode: Document, Code, and App (saved chats)

In a **saved** workspace chat (desktop app), the header includes **Document** | **Code** | **App**:

- **Code** — Workspace read/write/list/run tools are **on** for that chat immediately (no extra “switch” step).
- **Document** — Default assistant behavior; file tools are loaded **lazily** when the assistant calls **`switch_to_code_agent`** and completes the tool-discovery step the app describes.
- **App** — Keeps document-style behavior but **always** exposes the **workspace dashboard** tools (`read_workspace_dashboard`, `apply_workspace_dashboard`, `upsert_workspace_page`) so the model can edit `.braian/dashboard/board.json` and page JSON under `.braian/dashboard/pages/`. See [Dashboard & in-app pages](/docs/dashboard).

You can switch modes yourself, or stay on **Document** and ask the assistant to enable dashboard or code capabilities through its tools when needed.

## Workspace skills (`.braian/skills`)

In a **real workspace** on the **desktop app**, the assistant also gets tools to work with **Markdown skills**—reusable instructions stored under **`.braian/skills/*.md`** (YAML frontmatter with `name` and `description`, then the body). The **Model context** preview always includes a **create-skill** block and a **catalog** of skill metadata; the model loads full bodies with **`read_workspace_skill`** when needed.

| Tool | What it does |
|------|----------------|
| `list_workspace_skills` | Returns JSON listing skills (path, name, description)—same idea as the catalog in system context. |
| `read_workspace_skill` | Reads one `.md` file under `.braian/skills/` (no subfolders; path must stay under that directory). |
| `write_workspace_skill` | Creates or replaces a skill file; content must be valid skill Markdown (frontmatter + body). |

These tools are **not** available in the **You** profile coach, detached “new chat” without a folder, or in the browser-only dev preview.

## Workspace dashboard tools

When dashboard tools are active for a turn, the assistant can:

| Tool | What it does |
|------|----------------|
| `read_workspace_dashboard` | Read `board.json` and list page ids under `.braian/dashboard/pages/`. |
| `apply_workspace_dashboard` | Replace the entire board manifest (argument is a **JSON string** `manifestJson`). |
| `upsert_workspace_page` | Create or replace one page file (argument is a **JSON string** `pageJson`). |

The assistant should read before overwriting and merge carefully so tiles are not lost.

## Related

- [Model context](/docs/model-context)
- [Overview](/docs/overview)
- [Dashboard & in-app pages](/docs/dashboard)
- [Connections (MCP)](/docs/mcp)
- [Memory](/docs/memory)
- [Capabilities](/docs/capabilities)
