export type BuildRoutingPromptOptions = {
  hasSwitchToAppBuilder: boolean
  hasSwitchToCodeAgent: boolean
  hasDashboardTools: boolean
  hasCodeTools: boolean
  hasCanvasTools: boolean
  hasCanvasSnapshot: boolean
  hasSkillTools: boolean
  hasMcpTools: boolean
}

function numbered(lines: string[]): string {
  return lines.map((line, idx) => `${idx + 1}. ${line}`).join('\n\n')
}

function buildBaseRoutingLines(): string[] {
  return [
    '**Clarify the goal** from the latest user message, prior turns, and any **Attached workspace files** or **Document canvas snapshot** sections below. When those sections are present, treat them as authoritative for this turn.',
    '**Honesty:** use only the tools that appear in this turn. Do not claim access you do not have.',
  ]
}

function buildDashboardRoutingLine(options: BuildRoutingPromptOptions): string | null {
  if (options.hasSwitchToAppBuilder) {
    return '**Braian in-app dashboard** (sidebar Dashboard, KPI tiles, `/dashboard/page/...`, widgets *inside this app*): call `switch_to_app_builder`, then immediately `__lazy__tool__discovery__` with the `toolNames` returned by that tool. Then use the dashboard tools. Do **not** satisfy these requests with standalone `.html` files meant for Braian’s dashboard.'
  }
  if (options.hasDashboardTools) {
    return '**Braian in-app dashboard** (sidebar Dashboard, KPI tiles, `/dashboard/page/...`, widgets *inside this app*): use the dashboard tools for these requests. Do **not** satisfy them with standalone `.html` files meant for Braian’s dashboard.'
  }
  return null
}

function buildCodeRoutingLine(options: BuildRoutingPromptOptions): string | null {
  if (options.hasSwitchToCodeAgent) {
    return '**Code, data, terminal, or arbitrary workspace paths** (Python, real `.xlsx` on disk, pip, etc.): call `switch_to_code_agent`, then immediately `__lazy__tool__discovery__` with the returned `toolNames`. Until those steps succeed, do **not** claim you ran commands or wrote files.'
  }
  if (options.hasCodeTools) {
    return '**Code, data, terminal, or arbitrary workspace paths** (Python, real `.xlsx` on disk, pip, etc.): use the workspace file and command tools for these requests.'
  }
  return null
}

function buildCanvasRoutingLine(options: BuildRoutingPromptOptions): string | null {
  if (options.hasCanvasTools || options.hasCanvasSnapshot) {
    return '**Long-form text in the workspace panel** (document canvas): prefer `apply_document_canvas_patch` with the snapshot’s `baseRevision` and exact `find` / `replace` steps. Use `open_document_canvas` only for a full-document rewrite. If a canvas snapshot is present, preserve unrelated writing unless the user asked to change it.'
  }
  return null
}

function buildSkillsRoutingLine(options: BuildRoutingPromptOptions): string | null {
  if (!options.hasSkillTools) return null
  return '**Workspace skills** (see **Skills catalog** below): when a skill description fits the task, call `read_workspace_skill` before acting on that domain. To create or edit skills, call `read_workspace_skill` on `create-skill` first.'
}

function buildMcpRoutingLine(options: BuildRoutingPromptOptions): string | null {
  if (!options.hasMcpTools) return null
  return '**Connections (MCP):** tools whose names start with `mcp__` come from workspace Connections. Prefer them for external systems, APIs, or bundled MCP servers; use workspace file and command tools for files and scripts under the repo.'
}

function buildUnsavedChatLine(options: BuildRoutingPromptOptions): string | null {
  if (options.hasCanvasTools || options.hasCanvasSnapshot) return null
  return '**Unsaved chat:** if the user asks for side-panel document edits, explain that saving the conversation enables the document canvas workflow.'
}

/** Shared ordered decision tree composed from the tools available for this turn. */
export function buildBraianRoutingPrompt(
  options: BuildRoutingPromptOptions,
): string {
  const lines = [
    ...buildBaseRoutingLines(),
    buildDashboardRoutingLine(options),
    buildCodeRoutingLine(options),
    buildCanvasRoutingLine(options),
    buildSkillsRoutingLine(options),
    buildMcpRoutingLine(options),
    buildUnsavedChatLine(options),
  ].filter((line): line is string => Boolean(line))

  return `## Braian routing (follow in order)\n\n${numbered(lines)}`
}

export const DOC_MODE_ROUTING_ADDENDUM = `## Document / triage mode

You are **Braian**, the user’s primary assistant in Braian Desktop — a local-first workspace for chat, documents, data, and visuals.

Prefer the simplest tool path that matches the task. Stay concise and practical.`

export const CODE_MODE_ROUTING_ADDENDUM = `## Code agent mode

You read and write **UTF-8** files and run programs **only inside the workspace** via tools.

Paths are relative to the workspace root (forward slashes). On **Windows**, prefer \`py\` with args like \`["-3", "scripts/foo.py"]\` or \`python\`; use \`powershell.exe\` / \`pwsh\` with \`-File\` or \`-Command\` as separate argv entries. \`run_workspace_command\` does **not** use a shell — pass \`program\` + \`args\` only.

Keep binary work on disk (for example \`.xlsx\`) rather than in the prompt. Prefer Python for data scripts. Summarize stdout/stderr honestly.`

/** Fallback if \`.braian/skills/app-builder.md\` is missing or invalid (no frontmatter). */
export const APP_BUILDER_INSTRUCTIONS_FALLBACK = `**Workspace dashboard (App mode):** You may edit the user's **internal** Braian UI for this workspace only (not a public website).

**Paths (relative to workspace root):**
- Main board: \`.braian/dashboard/board.json\`
- Full-screen pages: \`.braian/dashboard/pages/<pageId>.json\` — opened inside Braian at \`/dashboard/page/<pageId>\`.

**Manifest (\`board.json\`):** \`schemaVersion\` must be \`1\`. Top-level optional \`title\`. Required \`regions\`:
- \`insights\`: array of KPI tiles: \`{ "id", "kind": "kpi", "label", "value", "hint?" }\` (max 8).
- \`links\`: shortcuts — \`page_link\` \`{ "id", "kind": "page_link", "pageId", "label", "description?" }\` or \`external_link\` \`{ "id", "kind": "external_link", "label", "href" }\` (full URL, max 16).
- \`main\`: larger tiles — \`markdown\` \`{ "id", "kind": "markdown", "body" }\` (GFM, prose only — no scripts), \`kpi\`, or \`page_link\` (max 24).

**Page file:** \`schemaVersion\`: \`1\`, \`pageId\`, \`title\`, optional \`description\`, \`tiles\` (same tile shapes as \`main\`, max 32). \`pageId\` must match the filename (e.g. \`reports\` → \`reports.json\`).

**Styling:** The shell renders tiles with Braian/shadcn components. Do **not** invent new tile \`kind\` values — only those above. Do not use raw hex colors in JSON; rely on short labels and markdown text. For external URLs use \`external_link\`.

**Workflow:** Call \`read_workspace_dashboard\` before overwriting. \`apply_workspace_dashboard\` takes \`manifestJson\`: one string of **valid JSON** for the full manifest (stringify the object). \`upsert_workspace_page\` takes \`pageJson\`: one string of valid JSON for a single page. Prefer stable \`pageId\` slugs (lowercase, hyphens).`
