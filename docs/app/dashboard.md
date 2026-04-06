# Workspace webapp (Vite)

Each workspace can host a **real** mini front-end: a **Vite + React + TypeScript** app under **`.braian/webapp/`**, copied from Braian’s bundled template. This is **not** a public hosted site by default—it runs as a **local dev server** inside Braian Desktop and is shown in an iframe.

## Where you see it

- **Sidebar → Webapp** (and **Navigation → Webapp**) opens the preview for the selected workspace (`/workspace/<id>/webapp`). The **`/dashboard`** route redirects there when a workspace is active.
- In **App** chat mode, the side **artifact** shows the same preview controls (init template, install deps, start/stop preview).

## Files on disk

| Path | Purpose |
|------|---------|
| `.braian/webapp/` | User-editable Vite project (`src/`, `package.json`, etc.). |
| `.braian/skills/app-builder.md` | Seeded skill with instructions for the model (App mode). |

Node.js and **npm** must be on your PATH for install and dev server.

## Chat modes: Document, Code, and App

| Mode | What it does |
|------|----------------|
| **Document** | Default; coding and **webapp helper** tools are **lazy** until the assistant calls **`switch_to_code_agent`** or **`switch_to_app_builder`** and completes discovery. |
| **Code** | Eager file/shell tools. Webapp helpers stay **lazy** (use **App** or the switch for full webapp workflow). |
| **App** | Eager **code** tools plus eager **`init_workspace_webapp`** and **`read_workspace_webapp_dev_logs`**, and the **app-builder** skill text. Use this to build or edit the Vite app. |

## Working with the assistant

- Ask for UI in **`.braian/webapp/src`** (components, forms, styling). The model should use **`run_workspace_shell`** with `cwd: ".braian/webapp"` for **`npm install`** / **`npm run build`** — not **`npm run dev`** (Braian starts the dev server).
- Use **`read_workspace_webapp_dev_logs`** after preview or compile issues.
- Use **`init_workspace_webapp`** when the project is missing or you want a clean template (`overwrite: true` replaces files).

## Related

- [Overview](/docs/overview)
- [Model context](/docs/model-context)
- [Tools](/docs/tools)
- [Capabilities](/docs/capabilities)
