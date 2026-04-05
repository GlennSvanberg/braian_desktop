# Braian Desktop — backlog

Tracked items from product notes (`NOTES.md`), repo review, and MCP gaps. Use `- [ ]` / `- [x]` as you complete work.

## In progress / hygiene

- Stabilize and land uncommitted work (connections UI, MCP probe, chat stream, Tauri `lib.rs`) and run a quick regression with `testcases.md` in `npm run tauri:dev`

## MCP

- Expose configured MCP servers to the chat agent as tools (or a thin proxy), not only `.braian/mcp.json` editing
- Implement full **remote** MCP transport for real use (e.g. SSE / streamable HTTP per spec), not only HTTP GET reachability in probe
- Align remote connection probe with chosen transport (handshake + tool discovery when protocol allows)

## Phase 1 MVP — data → workspace panel (`NOTES.md` §4)

- Add Tauri **file watcher** for a linked Excel/CSV (or chosen data file) under the workspace
- Add a **structured data bridge** (Rust CSV path and/or clear contract with on-disk JSON) feeding the tabular canvas
- Improve **tabular canvas** for real workloads: virtualization for large row sets, basic charts where product needs them
- Persist **dashboard / tabular** configuration across restarts (align with file-first direction in `NOTES.md` §7 when ready)

## File-first persistence (`NOTES.md` §7)

- Design on-disk layout (e.g. `.braian/conversations/`, `.braian/artifacts/`) and schema/version fields
- Migrate or export from current SQLite-backed conversation/artifact prototypes so data is not trapped
- Reserve SQLite for app prefs, recent workspaces, secrets/indexes — not primary durable chat/artifact payload

## Workspace history & sync (`NOTES.md` §6)

- Decide Git model (per-workspace repo, init/opt-in UX, `.gitignore` for secrets and large binaries)
- Optional remote (e.g. GitHub): auth, friction, and conflict story
- App-level **schema version** for on-disk conversation/artifact/manifest formats

## QA & polish

- Keep `testcases.md` updated as features ship; run it before releases
- Document limitations (e.g. `.xlsx` not injected as UTF-8 context; panel vs file-manager workflow) where users hit them

