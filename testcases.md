# AI chat — manual test cases

These cases describe what Braian Desktop’s chat **should** do given the features that exist today (TanStack AI, document canvas tool, code/workspace tools, file attachments, workspace file browser). Use them for QA and regression checks.

**Baseline setup (unless a case says otherwise)**

- Run the **desktop** app (`npm run tauri:dev`). Real provider chat does not work in the browser-only dev server (CORS); mock mode is optional via `localStorage.setItem("braian.mockAi","1")`.
- **Settings**: provider, model, and API key configured.
- A **workspace** is open (folder root known to the app).
- For any expectation that involves the **side panel document canvas** (`apply_document_canvas_patch` / `open_document_canvas`), the conversation must be **saved** (persisted conversation id). Unsaved chats do not get those tools.

**UI vocabulary**

- **Workspace panel**: the right-hand area that shows the document/data/visual canvas.
- **Workspace files**: collapsible section in the chat column — browse files, attach to context (paperclip), or **Show in file manager** (folder icon) to reveal a path in the OS file explorer. There is **no** dedicated “open this output file” button inside the assistant bubble; the user reaches outputs via paths in the reply and/or this file list.

---

## 1. CSV → Excel workbook (medium — code agent + canvas preview)

**Goal:** Convert a text CSV into a real `.xlsx` on disk and give a readable summary in the workspace panel.

**Preconditions**

- Saved chat (so `open_document_canvas` is available).
- CSV is in the workspace as UTF-8 (or attach it with @ / drag-drop so its contents are injected for this turn).

**User actions**

1. Attach `data/sample.csv` (or drop it / @ mention).
2. Ask: e.g. “Turn this into an Excel file.”

**Expected behavior**

1. The model recognizes that **binary Excel** cannot be produced in markdown alone; it calls **`switch_to_code_agent`**, then **`__lazy__tool__discovery__`** with the workspace tool names, then uses **`write_workspace_file`** / **`run_workspace_command`** (e.g. Python + pandas/openpyxl) under the workspace.
2. A **`.xlsx` file** appears under the workspace at a path the model chooses (e.g. `output/sample.xlsx`); **`run_workspace_command`** returns captured stdout/stderr so errors are visible if conversion fails.
3. The model calls **`open_document_canvas`** with markdown that includes:
   - a short **inspection / summary** (columns, row counts, sample rows as a **markdown table** if useful — not a native Excel renderer);
   - a **deliverables** section listing **relative paths** to the `.xlsx` (and any script path).
4. The **workspace panel** updates to that markdown (document canvas).
5. The user can open **Workspace files**, navigate to the new `.xlsx`, and use **Show in file manager** to open the containing folder (or rely on the OS default app from Explorer).

**Limitations / notes**

- The panel does **not** render `.xlsx` as a spreadsheet control; “preview” means **markdown** (tables/samples) plus trust in the on-disk file.
- **`.xlsx` attached as context** does not inject cell data into the prompt (binary files are rejected for UTF-8 context reads). For Excel sources, the model must use **Python in the workspace** to read the file by path, or the user should provide **CSV** for text attachment.

---

## 2. Long-form document in the workspace panel (low — canvas only, no code)

**Goal:** Draft or revise prose that lives in the side panel and on disk as conversation-linked markdown.

**Preconditions**

- Saved chat.

**User actions**

1. Ask: e.g. “Write a one-page project brief for …” or “Shorten the canvas to bullet points.”

**Expected behavior**

1. The model prefers **`apply_document_canvas_patch`** with exact `find`/`replace` steps and the snapshot **revision** as `baseRevision`. It may use **`open_document_canvas`** only for a **full rewrite**. The **document canvas snapshot** reflects the latest editor text (including manual edits not yet autosaved to the thread).
2. **Selection mini-prompt:** With text selected in the canvas, the floating prompt sends the instruction with **section-only** context; the model should limit patches to that region when possible.
3. The **workspace panel** shows the rendered markdown; chat contains a **brief** acknowledgment (tool return text already tells the model not to dump the whole doc in chat).
4. No claim of having run shell commands or written arbitrary binaries unless **`run_workspace_command`** was actually invoked.

**Limitations / notes**

- If the chat is **not** saved, canvas tools are absent; the model should **explain** that saving the conversation enables the side panel document tool, not pretend the canvas was updated.
- **Large documents:** snapshot text in the system prompt may be **truncated** past a character budget; the model should use distinctive `find` strings or ask the user to narrow scope if a patch fails.

---

## 3. Unsaved chat asks for “put this in the canvas” (low — guardrail)

**Goal:** Correct behavior when the document tool is unavailable.

**Preconditions**

- New / **unsaved** conversation (no persisted id passed as `conversationId` for tools).

**User actions**

1. Ask: “Put this spec in the workspace document.”

**Expected behavior**

1. The model does **not** claim the side panel was updated via tool (tool is not offered).
2. It tells the user they need to **save the chat first**, then they can ask again — aligned with triage system prompt.

---

## 4. Read and summarize files from the workspace (medium — code or read tools)

**Goal:** Use workspace-scoped tools to inspect multiple files and report in chat and/or canvas.

**Preconditions**

- Saved chat (if you want a structured **canvas** summary with `open_document_canvas`).
- Target files are **UTF-8 text** (e.g. `.md`, `.json`, `.ts`, `.csv`) or the model must use **Python** to read non-UTF8/binary by path.

**User actions**

1. Optionally @-attach one file; ask: “List what’s in `src/` and summarize `README.md`.”

**Expected behavior**

1. The model uses **`list_workspace_dir`** / **`read_workspace_file`** and/or enables the code agent and **`run_workspace_command`** as needed.
2. Answers are **grounded** in tool results (paths, snippets), not invented file contents.
3. For a polished summary in the panel, it may call **`open_document_canvas`** with markdown sections per file or theme.

**Limitations / notes**

- **`read_workspace_file`** is UTF-8 only; binary files error with a clear message from the tool.

---

## 5. Workspace memory (`MEMORY.md`) shapes answers (low — injected context)

**Goal:** Persistent instructions or facts in the repo are respected when present.

**Preconditions**

- Workspace contains **`.braian/MEMORY.md`** (`MEMORY_RELATIVE_PATH` in `src/lib/memory/constants.ts`) with distinctive content, e.g. “Always call the product **WidgetPro**, never Acme.”

**User actions**

1. Ask something that would normally use a generic product name.

**Expected behavior**

1. The model’s system context includes a **“Workspace memory”** block sourced from that file (truncated if very large).
2. Replies follow **`MEMORY.md`** unless the user explicitly overrides in the message.

**Limitations / notes**

- If `MEMORY.md` is missing or empty, no memory block is added (silent).

---

## 6. Shell command execution (medium — code mode + shell tool)

**Goal:** Run shell commands with pipes, chaining, and environment variables under the workspace.

**Preconditions**

- Saved chat, **Code** mode (or model auto-switches via `switch_to_code_agent`).
- Desktop app (Tauri runtime).

**User actions**

1. Ask: "Install pandas and create a quick script to plot sales data."

**Expected behavior**

1. The model uses **`run_workspace_shell`** for shell one-liners like `pip install pandas openpyxl` or `npm install`.
2. Shell commands run via `cmd.exe /C` (Windows) or `sh -c` (Unix) with cwd under workspace root.
3. For script creation, the model uses **`write_workspace_file`** or **`patch_workspace_file`** to write the script, then **`run_workspace_shell`** or **`run_workspace_command`** to execute it.
4. Stdout/stderr are reported honestly; timeouts are handled gracefully.

**Limitations / notes**

- Shell commands can reference paths outside the workspace (cwd is the only boundary).
- Network access is allowed (e.g. `pip install`, `npm install`, `git clone`).
- No interactive shell; commands must complete without user input.

---

## 7. Search + patch workflow (medium — code mode)

**Goal:** Find code by content and make targeted edits without full-file rewrites.

**Preconditions**

- Saved or unsaved chat with a workspace, **Code** mode.

**User actions**

1. Ask: "Find all uses of `oldFunctionName` and rename it to `newFunctionName`."

**Expected behavior**

1. The model calls **`search_workspace`** with query `oldFunctionName` to find all files and line numbers.
2. For each file with matches, the model calls **`patch_workspace_file`** with `find`/`replace` steps (using `replaceAll: true` for the rename).
3. The model reports which files were updated and how many replacements were made.
4. If `search_workspace` returns truncated results (>200 matches), the model notes the truncation and suggests narrowing the search.

**Limitations / notes**

- `search_workspace` is plain text matching (escaped as regex), not semantic search.
- `patch_workspace_file` requires exact string matches; ambiguous matches return an error with guidance.

---

## 8. Tabular and visual canvas (medium — canvas tools)

**Goal:** Display structured data or images in the side-panel canvas.

**Preconditions**

- Saved chat (so canvas tools are available).

**User actions**

1. Ask: "Show me a summary table of the top 10 products by revenue."
2. Or: "Display this chart image in the canvas."

**Expected behavior**

1. For tabular data, the model calls **`apply_tabular_canvas`** with `columns` and `rows` matching the data.
2. For images/visuals, the model calls **`apply_visual_canvas`** with `imageSrc`, `title`, and `alt`.
3. The side panel updates to show the table or image (replacing previous canvas content).

**Limitations / notes**

- Tabular canvas replaces the entire canvas; there is no patch tool for tabular data.
- Visual canvas requires an image URL or data URI; the model cannot generate images natively without an image generation skill/MCP.

---

## Automated alignment (headless CLI)

`npm run test` includes subprocess checks that run `tsx src/cli/braian-ai.ts dump-request` against JSON contexts matching §§1–5 (tool lists and system sections only — no provider calls), plus **workspace skills** sections and tools when `workspaceId` is workspace-scoped (catalog text reflects Node’s non-Tauri load). See [`src/cli/braian-ai.testcases.integration.test.ts`](src/cli/braian-ai.testcases.integration.test.ts). **§5** full behavior (real `MEMORY.md` on disk) is additionally covered with a mocked file read in [`src/lib/ai/chat-turn-args.test.ts`](src/lib/ai/chat-turn-args.test.ts) (`testcases.md §5`).

---

## Quick traceability (where this is implemented)

| Area | Location (indicative) |
|------|------------------------|
| Triage vs code agent prompts | `src/lib/ai/tanstack-chat-stream.ts` |
| `open_document_canvas` → disk + panel | `src/lib/ai/canvas-tools.ts`, Tauri `canvas_document_write` |
| Workspace read/write/list/run/shell/search/patch | `src/lib/ai/coding-tools.ts` → `src/lib/workspace-api.ts` / Tauri |
| Shell execution (Rust) | `src-tauri/src/workspace_agent.rs` (`workspace_run_shell`) |
| Text search (Rust) | `src-tauri/src/workspace_files.rs` (`workspace_search_text`) |
| Patch logic (shared) | `src/lib/ai/text-patches.ts` (used by both canvas patch and file patch) |
| Switch to code + lazy discovery | `src/lib/ai/switch-code-agent-tool.ts` |
| Stream chunks → UI | `src/lib/ai/types.ts`, `src/lib/chat-sessions/store.ts` |
| Panel rendering | `src/components/app/artifact-panel.tsx` |
| Attach + reveal files | `src/components/app/workspace-files-panel.tsx` |
| Artifact shapes (document / tabular / visual) | `src/lib/artifacts/types.ts` |
| Tabular + visual canvas tools | `src/lib/ai/canvas-tools.ts` (`apply_tabular_canvas`, `apply_visual_canvas`) |

When a testcase and the product disagree, treat the testcase as the **desired** behavior and either fix the app or adjust this file after intentional changes.
