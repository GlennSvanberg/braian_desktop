The model only has the abilities the app gives it through **tools**. If it has not called a tool, it has not read a file, run a command, or updated the canvas—regardless of what it says.

How instructions and tool lists are combined each turn—including **routing**, **skills**, and **user profile**—is described in [Model context](/docs/model-context).

**Workspace MCP connections** (gear icon next to each workspace in the sidebar → **Workspace settings**, file `.braian/mcp.json`) extend the assistant with **MCP tools** when those servers are enabled. See [Connections (MCP)](/docs/mcp).

## Canvas tools

When your chat is **saved**, the assistant can update the side-panel canvas. Three canvas kinds are supported:

### Document canvas (`apply_document_canvas_patch`, `open_document_canvas`)

- **`apply_document_canvas_patch`** (preferred): ordered **`find` / `replace`** steps against the latest canvas text, with a **`baseRevision`** that must match the snapshot (optimistic locking). Use for typical edits.
- **`open_document_canvas`**: replace the **entire** markdown at once — for full rewrites or new documents when patches would be unwieldy.

The app sends a **document canvas snapshot** each turn (including **revision** and any **selection** from the inline canvas prompt). **Binary files** (for example `.xlsx`) belong on disk via scripts, not inside the canvas.

### Tabular canvas (`apply_tabular_canvas`)

Displays structured data as a table in the side panel. Takes `columns` (id, label, optional type hint) and `rows` (keyed by column id), with optional `title` and `sourceLabel`.

### Visual canvas (`apply_visual_canvas`)

Displays an image in the side panel. Takes optional `title`, `prompt`, `imageSrc` (URL or data URI), and `alt` text.

## Workspace file and command tools

When **code-style** workspace tools are enabled, the assistant can:

| Tool | What it does |
|------|----------------|
| `read_workspace_file` | Read a UTF-8 text file under the workspace (fails on binary-only content). |
| `write_workspace_file` | Create or overwrite a UTF-8 file; parent folders are created as needed. |
| `patch_workspace_file` | Apply targeted find/replace edits to an existing file. Preferred over `write_workspace_file` for small changes to large files. |
| `list_workspace_dir` | List files and folders in one directory (not recursive). |
| `search_workspace` | Search for text across all files in the workspace (recursive). Returns matching lines with file paths and line numbers. |
| `run_workspace_command` | Run a program with exact argv (**no shell**). Stdout and stderr are captured; very large output may be truncated. |
| `run_workspace_shell` | Run a shell command string (pipes, redirects, chaining). Windows: `cmd.exe /C`. Unix: `sh -c`. |

Paths are always **relative to the workspace root**. The shell tool provides full shell syntax while the command tool gives deterministic argv execution.

## Chat mode: Document, Code, and App (saved chats)

In a **saved** workspace chat (desktop app), the header includes **Document** | **Code** | **App**:

- **Code** — All workspace **coding** tools (read, write, patch, search, list, shell, command) are **on** for that chat immediately. **Webapp helper** tools (`init_workspace_webapp`, `read_workspace_webapp_dev_logs`) stay **lazy** until the assistant uses **`switch_to_app_builder`** and discovery (same as Document). The routing prompt includes a tool selection guide for files and commands.
- **Document** — Default assistant behavior; coding and webapp helpers are loaded **lazily** when the assistant calls **`switch_to_code_agent`** or **`switch_to_app_builder`** and completes the tool-discovery step. The model is only told about each workflow when the corresponding switch tool is available in the current turn.
- **App** — **Full code mode** (eager coding tools) **plus** eager **webapp helpers** (`init_workspace_webapp`, `read_workspace_webapp_dev_logs`) and the **app-builder** instructions so the model can edit **`.braian/webapp/`**. The chat side panel shows a **live Vite preview** (same idea as the Webapp route). See [Workspace webapp](/docs/dashboard).

You can switch modes yourself, or stay on **Document** and ask the assistant to enable webapp or code capabilities through its tools when needed.

## Workspace skills (`.braian/skills`)

In a **real workspace** on the **desktop app**, the assistant also gets tools to work with **Markdown skills** — reusable instructions stored under **`.braian/skills/*.md`** (YAML frontmatter with `name` and `description`, then the body). The **Model context** preview includes a **catalog** of skill metadata (name + description per file); the model loads full bodies with **`read_workspace_skill`** when needed.

| Tool | What it does |
|------|----------------|
| `list_workspace_skills` | Returns JSON listing skills (path, name, description)—same idea as the catalog in system context. |
| `read_workspace_skill` | Reads one `.md` file under `.braian/skills/` (no subfolders; path must stay under that directory). |
| `write_workspace_skill` | Creates or replaces a skill file; content must be valid skill Markdown (frontmatter + body). |

These tools are **not** available in the **You** profile coach, detached "new chat" without a folder, or in the browser-only dev preview.

## Workspace webapp helpers

When webapp helpers are active for a turn, the assistant can:

| Tool | What it does |
|------|----------------|
| `init_workspace_webapp` | Copy the bundled Vite template into `.braian/webapp/` (optional `overwrite`). |
| `read_workspace_webapp_dev_logs` | Read recent stdout/stderr from the Braian-managed Vite dev server (ring buffer). |

The dev server itself is started from the UI, not via `npm run dev` in the shell tool.

## Related

- [Model context](/docs/model-context)
- [Overview](/docs/overview)
- [Workspace webapp](/docs/dashboard)
- [Connections (MCP)](/docs/mcp)
- [Memory](/docs/memory)
- [Capabilities](/docs/capabilities)
