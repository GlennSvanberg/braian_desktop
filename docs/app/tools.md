The model only has the abilities the app gives it through **tools**. If it has not called a tool, it has not read a file, run a command, or updated the canvas—regardless of what it says.

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

## Switching to “code agent” capabilities

In **document-style** turns, heavy file and terminal work starts with the assistant calling **`switch_to_code_agent`**, then the lazy tool discovery step the app describes. After that, the read/write/list/run tools become available for that conversation. You do **not** need a separate “code mode” toggle in the UI—the assistant enables it when needed.

## Related

- [Overview](/docs/overview)
- [Memory](/docs/memory)
- [Capabilities](/docs/capabilities)
