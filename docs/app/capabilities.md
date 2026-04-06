## What you control

- **Bring your own key (BYOK):** You add API keys and choose **provider** and **model** in **Settings**. The app sends requests from the desktop shell so keys stay on your side; there is no Braian-hosted model API in this app.
- **User profile:** **Sidebar → You** stores a small **global profile** (name, languages, notes, etc.) on this device. It is injected into **workspace** chats as part of **user context** so replies can match how you want to be addressed; the **You** chat exists only to edit that profile. See [Model context](/docs/model-context).
- **Workspace scope:** File access and commands are limited to the **active workspace** folder. The assistant cannot browse arbitrary paths on your PC outside that root.
- **Attachments:** When you attach or reference workspace files, the app may include excerpts in context; large files can be truncated.
- **Workspace webapp:** The Vite app under `.braian/webapp/` runs as a **local dev server** in Braian. It is not a public site by default. See [Workspace webapp](/docs/dashboard).
- **Connections (MCP):** Optional **Model Context Protocol** servers are listed per workspace in **`.braian/mcp.json`** (Cursor-compatible `mcpServers`). The UI can **probe** stdio or remote entries for a quick health check; attaching those tools to chat is separate from built-in workspace tools. See [Connections (MCP)](/docs/mcp).

## What the assistant can and cannot do

- **Text files:** Read, write, and patch UTF-8 text via tools when enabled; binary-only reads fail by design. Use `search_workspace` to find code by content across the workspace.
- **Shell access:** In **Code** mode, the assistant can run shell commands (`run_workspace_shell`) with full shell syntax — pipes, redirects, chaining, environment variables. The working directory is set under the workspace root, but shell commands can reference paths outside. Network access is allowed. This is a deliberate trade-off for power; the cwd guardrail is the primary boundary.
- **Argv commands:** `run_workspace_command` runs a program with exact arguments (no shell interpretation) for deterministic subprocess invocations.
- **Patch edits:** `patch_workspace_file` applies targeted find/replace steps to existing files, reducing token use and stomping risk versus full-file rewrites.
- **Canvas:** The side panel supports **document** (markdown), **tabular** (structured data tables), and **visual** (images) canvas types. Each has dedicated tools.
- **New vs saved chat:** Some tools (for example updating the canvas) require a **saved** conversation.

## What this app is not

- There is **no** built-in cloud backend or shared database for your chats in this repository version—data is local (SQLite and files under your machine / workspace as implemented).
- It is not a replacement for source control, deployment pipelines, or IT policy tools; use normal practices for sensitive code and secrets.

## Related

- [Overview](/docs/overview)
- [Model context](/docs/model-context)
- [Workspace webapp](/docs/dashboard)
- [Tools](/docs/tools)
- [Connections (MCP)](/docs/mcp)
- [Memory](/docs/memory)
