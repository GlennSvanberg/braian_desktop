Braian Desktop is a **local-first** workspace: your chats and project files stay oriented around folders on your machine, not a cloud account in this app.

## Workspaces

A **workspace** is a folder you choose as the active project root. The assistant can only read, write, and run commands **inside that workspace** (see [Tools](/docs/tools)). Pick the right folder in the workspace switcher at the top of the sidebar.

## Chat and the side panel

- **Chat** is where you talk to the assistant.
- The **document canvas** (side panel) holds long-form markdown the assistant can update as a working document—specs, drafts, reports—while chat stays conversational.
- **You** (sidebar) opens a dedicated **profile** chat: the assistant can update your global preferences and identity fields stored on this device; that session uses a different prompt than workspace chats. See [Model context](/docs/model-context).
- **Webapp** (sidebar) opens a per-workspace **Vite + React** preview under `.braian/webapp/`. See [Workspace webapp](/docs/dashboard).

Some assistant actions only work after the conversation is **saved** (a real thread, not only “new chat”). If something is unavailable, start or open a saved chat and try again.

## Where things run

- **Desktop app (Tauri):** Full experience—AI with your keys, workspace tools, file access.
- **Browser dev (`npm run dev`):** Layout and UI only; real AI and workspace integration expect the desktop shell. Developers can use mock mode where documented for local testing.

## Next topics

- [Model context](/docs/model-context) — how prompts, skills, and profile are assembled each turn
- [Workspace webapp](/docs/dashboard)
- [Tools the assistant can use](/docs/tools)
- [Connections (MCP)](/docs/mcp) — `.braian/mcp.json`, Cursor-style servers, status checks
- [Workspace memory](/docs/memory)
- [Capabilities and limits](/docs/capabilities)
