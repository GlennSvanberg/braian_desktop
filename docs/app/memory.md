**Memory** is a durable markdown note stored **inside your workspace** so the assistant can remember stable facts, preferences, and context across chats.

## Where it lives

The file path is **`.braian/MEMORY.md`** (under the active workspace root). You can open or edit it like any other file; the app may overwrite it when memory is updated.

## How it is used

When you chat with a saved conversation in a workspace, the app can **inject** the contents of `MEMORY.md` (up to a size limit) into the model context so replies stay aligned with what you have stored there.

In the full **workspace** prompt stack, memory appears **after** routing, skills, and **user profile** context, and **before** optional attachments and canvas snapshot for that message. See [Model context](/docs/model-context).

## Updating memory

1. **Manual:** From an open chat, use **Update memory** when you want the app to refresh `MEMORY.md` from recent conversation (subject to app rules and limits).
2. **Automatic:** In **Settings**, you can turn on **Automatically update memory when I pause chatting**. When enabled, the app schedules a debounced review after you stop sending messages for a while, and also respects minimum intervals so updates are not constant.

Memory updates are produced by the model merging new information with the existing file—contradictions should be resolved, duplicates avoided.

## Related

- [Overview](/docs/overview)
- [Model context](/docs/model-context)
- [Workspace webapp](/docs/dashboard)
- [Tools](/docs/tools)
- [Capabilities](/docs/capabilities)
