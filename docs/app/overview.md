Braian Desktop is a **local-first** workspace: your chats and project files stay oriented around folders on your machine, not a cloud account in this app.

## Workspaces

A **workspace** is a folder you choose as the active project root. The assistant can only read, write, and run commands **inside that workspace** (see [Tools](/docs/tools)). Pick the right folder in the workspace switcher at the top of the sidebar.

## Chat and the side panel

- **Chat** is where you talk to the assistant.
- The **document canvas** (side panel) holds long-form markdown the assistant can update as a working document—specs, drafts, reports—while chat stays conversational.
- The **Dashboard** (sidebar) shows a per-workspace board of tiles and optional full-screen **in-app pages**—all defined as JSON under `.braian/dashboard/` in that workspace. See [Dashboard & in-app pages](/docs/dashboard).

Some assistant actions only work after the conversation is **saved** (a real thread, not only “new chat”). If something is unavailable, start or open a saved chat and try again.

## Where things run

- **Desktop app (Tauri):** Full experience—AI with your keys, workspace tools, file access.
- **Browser dev (`npm run dev`):** Layout and UI only; real AI and workspace integration expect the desktop shell. Developers can use mock mode where documented for local testing.

## Next topics

- [Dashboard & in-app pages](/docs/dashboard)
- [Tools the assistant can use](/docs/tools)
- [Workspace memory](/docs/memory)
- [Capabilities and limits](/docs/capabilities)
