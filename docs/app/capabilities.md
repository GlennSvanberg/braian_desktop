## What you control

- **Bring your own key (BYOK):** You add API keys and choose **provider** and **model** in **Settings**. The app sends requests from the desktop shell so keys stay on your side; there is no Braian-hosted model API in this app.
- **Workspace scope:** File access and commands are limited to the **active workspace** folder. The assistant cannot browse arbitrary paths on your PC outside that root.
- **Attachments:** When you attach or reference workspace files, the app may include excerpts in context; large files can be truncated.

## What the assistant can and cannot do

- **Text files:** Read/write UTF-8 text via tools when enabled; binary-only reads fail by design.
- **Commands:** Non-interactive runs with captured output; not a full remote desktop or unrestricted shell.
- **Canvas:** Markdown in the side panel for documents; not a substitute for spreadsheets or binaries on disk.
- **New vs saved chat:** Some tools (for example updating the document canvas) require a **saved** conversation.

## What this app is not

- There is **no** built-in cloud backend or shared database for your chats in this repository version—data is local (SQLite and files under your machine / workspace as implemented).
- It is not a replacement for source control, deployment pipelines, or IT policy tools; use normal practices for sensitive code and secrets.

## Related

- [Overview](/docs/overview)
- [Tools](/docs/tools)
- [Memory](/docs/memory)
