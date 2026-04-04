import { z } from 'zod'

import type { AiSettingsDto } from '@/lib/ai-settings-api'
import { aiSettingsGet } from '@/lib/ai-settings-api'
import type { AiProviderId } from '@/lib/ai/model-catalog'
import {
  MEMORY_INJECT_MAX_BYTES,
  MEMORY_RELATIVE_PATH,
} from '@/lib/memory/constants'
import { isDetachedWorkspaceSessionId } from '@/lib/chat-sessions/detached'
import { workspaceReadTextFile } from '@/lib/workspace-api'

import { buildCanvasTools } from './canvas-tools'
import { buildCodingTools } from './coding-tools'
import { isMockAiMode } from './mock-mode'
import { buildSwitchToCodeAgentTool } from './switch-code-agent-tool'
import type { ChatTurnContext, PriorChatMessage } from './types'

import type { ModelMessage, Tool } from '@tanstack/ai'

export const TRIAGE_SYSTEM = `You are Braian, the user's primary assistant in Braian Desktop — a local-first workspace for business users with chat and a workspace panel for documents, data, and visuals.

When the user wants to draft or co-write long-form text (stories, specs, documents) in the workspace canvas, call the tool open_document_canvas with the **complete** markdown for the file after your edits.

If a "Document canvas snapshot" system message is present, it is the **authoritative latest text** (including the user's manual edits). Start from that snapshot, apply only what they asked for, and pass the **full merged** markdown to open_document_canvas—never discard their writing unless they explicitly asked to remove it.

If a "Attached workspace files" system message is present, those excerpts are the **authoritative file contents for this turn** (paths are relative to the workspace root). Large files may be truncated.

**Workspace capabilities:** When the chat is saved you have the document canvas tool. For tasks that need Python, terminal commands, real \`.xlsx\` / files on disk, or reading arbitrary workspace paths, **you** enable code tools: call \`switch_to_code_agent\`, then immediately call \`__lazy__tool__discovery__\` with the toolNames returned by that tool. After that, use read/write/list/run tools — do **not** ask the user to change modes in the UI. Until you complete those steps, do not claim you ran scripts or wrote binary files. You may still draft markdown in the canvas when that alone satisfies the request.

If open_document_canvas is not available (unsaved chat), say they need a saved conversation first, then they can ask again.

You may use tools offered in this turn when appropriate. Do not claim to have read arbitrary files or run shell commands unless those tools exist here or the user attached file content in the system messages above.`

export const CODE_AGENT_SYSTEM = `You are a coding-style agent in Braian Desktop (local-first workspace). You can read and write UTF-8 files and run programs **only inside the user's active workspace** via the provided tools.

Workflow (like a CLI coding assistant): understand the task → read or list files as needed → write or update scripts (prefer **Python** for data work: CSV, Excel via pandas/openpyxl, downloads with urllib/requests) → run commands to install deps (e.g. pip/uv) and execute scripts → report stdout/stderr and outcomes honestly.

If the user @-attached a **CSV or UTF-8 text** file, the system message includes an excerpt and path — you may use \`read_workspace_file\` on that path. **Binary Excel (\`.xlsx\`) is not injected** into the prompt; use the **path** from the attachment line and run **Python/pandas** via \`run_workspace_command\` to read or convert it. Produce requested outputs (e.g. \`.xlsx\`) on disk with tools, not just prose.

Rules:
- Paths in tools are always **relative to the workspace root** (use forward slashes).
- On **Windows**, prefer \`py\` with args like \`["-3", "scripts/foo.py"]\` or \`python\`; use \`powershell.exe\` or \`pwsh\` with \`-File\` or \`-Command\` as separate argv entries if Python is unavailable.
- \`run_workspace_command\` does **not** use a shell: pass \`program\` + \`args\` only (no pipes unless you run a shell explicitly as program).
- Do not claim a file was written or a command ran without a successful tool result.
- Keep chat messages concise; put long output in tool results, then summarize.
- If attached file excerpts appear below, treat them as authoritative for this turn alongside what you read from disk.

**Structured data (CSV, Excel, spreadsheets):** Use **Python with pandas** (and openpyxl or xlsxwriter as needed) via \`run_workspace_command\` to **inspect** files (shape, dtypes, head/sample rows, missing values) and to **produce real outputs** on disk (e.g. \`.xlsx\`). Do **not** satisfy “convert to Excel” or “inspect this file” with prose-only pasted CSV or generic instructions when tools can run code.

**Document canvas previews:** When the \`open_document_canvas\` tool is available (saved conversation), after you have inspected and/or written outputs, call it with **full markdown** for the workspace panel: a short **inspection summary** (tables or bullet points derived from your pandas/script output) and a **deliverables** section (relative paths under the workspace, row/column notes). For huge tables, show a **sample** in the canvas and point to the on-disk file for the full data. If a “Document canvas snapshot” system message is present, merge your report into that markdown (preserve the user’s manual edits unless they asked to remove them). If \`open_document_canvas\` is not in this turn (unsaved chat), say that saving the chat enables side-panel previews.

Safety: the user runs this on their own machine; you still must stay within workspace-scoped tools and not assume access outside them.`

export type ChatSystemSectionDisplay = {
  id: string
  label: string
  source: string
  text: string
}

export type ChatToolDisplayInfo = {
  name: string
  description: string
  lazy?: boolean
  sourceModule: string
  /** JSON Schema payload for the tool input (structure depends on Zod → JSON Schema). */
  inputJsonSchema?: object | null
}

export type SerializableModelRequestSnapshot = {
  builtAt: number
  userText: string
  provider: string
  modelId: string
  mockAi: boolean
  isCodeMode: boolean
  settingsWarnings: string[]
  systemSections: ChatSystemSectionDisplay[]
  messages: { role: string; content: string }[]
  tools: ChatToolDisplayInfo[]
}

const SOURCE_PRIMARY_DOC = 'src/lib/ai/chat-turn-args.ts (TRIAGE_SYSTEM)'
const SOURCE_PRIMARY_CODE = 'src/lib/ai/chat-turn-args.ts (CODE_AGENT_SYSTEM)'
const SOURCE_MEMORY = `src/lib/ai/chat-turn-args.ts → workspaceReadTextFile (${MEMORY_RELATIVE_PATH})`
const SOURCE_CONTEXT_FILES = 'src/lib/ai/chat-turn-args.ts (contextFilesSystemPrompt)'
const SOURCE_CANVAS_SNAPSHOT = 'src/lib/ai/chat-turn-args.ts (documentCanvasSnapshotPrompt)'

const TOOL_SOURCE_BY_NAME: Record<string, string> = {
  open_document_canvas: 'src/lib/ai/canvas-tools.ts',
  read_workspace_file: 'src/lib/ai/coding-tools.ts',
  write_workspace_file: 'src/lib/ai/coding-tools.ts',
  list_workspace_dir: 'src/lib/ai/coding-tools.ts',
  run_workspace_command: 'src/lib/ai/coding-tools.ts',
  switch_to_code_agent: 'src/lib/ai/switch-code-agent-tool.ts',
  __lazy__tool__discovery__: '@tanstack/ai (lazy tool discovery)',
}

export async function loadWorkspaceMemorySystemBlock(
  workspaceId: string,
): Promise<string> {
  if (isDetachedWorkspaceSessionId(workspaceId)) {
    return ''
  }
  try {
    const { text, truncated } = await workspaceReadTextFile(
      workspaceId,
      MEMORY_RELATIVE_PATH,
      MEMORY_INJECT_MAX_BYTES,
    )
    const t = text.trim()
    if (!t) return ''
    const note = truncated
      ? '\n[Note: MEMORY.md was truncated for context size — beginning only.]\n'
      : ''
    return `Workspace memory (from \`${MEMORY_RELATIVE_PATH}\`):${note}\n\n${t}`
  } catch {
    return ''
  }
}

export function contextFilesSystemPrompt(
  files: NonNullable<ChatTurnContext['contextFiles']>,
): string {
  if (files.length === 0) return ''
  const lines: string[] = [
    'Attached workspace files for this user message (paths relative to workspace root).',
    '',
  ]
  for (const f of files) {
    const label = f.displayName?.trim() || f.relativePath
    const truncNote = f.fileTruncated
      ? '\n[Note: this file was truncated by size limits — only the beginning is included.]\n'
      : ''
    lines.push(`--- FILE: ${f.relativePath} (${label}) ---`)
    lines.push(f.text)
    lines.push(truncNote + '--- END FILE ---\n')
  }
  return lines.join('\n')
}

export function documentCanvasSnapshotPrompt(
  snapshot: NonNullable<ChatTurnContext['documentCanvasSnapshot']>,
): string {
  const titleNote =
    snapshot.title != null && snapshot.title !== ''
      ? `Canvas title: ${snapshot.title}\n\n`
      : ''
  return (
    `${titleNote}Document canvas snapshot (latest markdown from the workspace panel as of this user message — your open_document_canvas output must be this entire text plus your edits, preserving the user's work):\n\n` +
    snapshot.body
  )
}

function toolSourceModule(name: string): string {
  return TOOL_SOURCE_BY_NAME[name] ?? '@tanstack/ai'
}

function zodInputSchemaToJson(schema: unknown): object | undefined {
  if (schema == null || typeof schema !== 'object') return undefined
  try {
    const raw = z.toJSONSchema(schema as z.ZodType) as unknown
    if (raw != null && typeof raw === 'object') {
      return raw as object
    }
    return undefined
  } catch {
    return undefined
  }
}

function toolToDisplayInfo(t: {
  name: string
  description: string
  lazy?: boolean
  inputSchema?: unknown
}): ChatToolDisplayInfo {
  return {
    name: t.name,
    description: t.description,
    ...(t.lazy === true ? { lazy: true } : {}),
    sourceModule: toolSourceModule(t.name),
    inputJsonSchema: zodInputSchemaToJson(t.inputSchema),
  }
}

export type BuildTanStackChatTurnArgsOptions = {
  userText: string
  context?: ChatTurnContext
  priorMessages?: PriorChatMessage[]
  /** If set, skips aiSettingsGet() inside the builder. */
  settings?: AiSettingsDto
  /**
   * When false (default), missing API key / model adds warnings instead of throwing.
   * TanStack streaming still validates separately before calling the API.
   */
  skipSettingsValidation?: boolean
}

export type BuildTanStackChatTurnArgsResult = {
  systemSections: ChatSystemSectionDisplay[]
  systemPrompts: string[]
  messages: ModelMessage[]
  tools: Tool[]
  toolsDisplay: ChatToolDisplayInfo[]
  provider: AiProviderId
  modelId: string
  baseUrl: string | null
  /** Trimmed; for the provider adapter only (omit from debug snapshots). */
  apiKey: string
  mockAi: boolean
  isCodeMode: boolean
  conversationId: string | undefined
  maxIterations: number | null
  settingsWarnings: string[]
}

/** Builds the same logical payload passed to TanStack `chat()` for a turn. */
export async function buildTanStackChatTurnArgs(
  options: BuildTanStackChatTurnArgsOptions,
): Promise<BuildTanStackChatTurnArgsResult> {
  const settings =
    options.settings ?? (await aiSettingsGet())

  const settingsWarnings: string[] = []
  if (!settings.apiKey.trim()) {
    settingsWarnings.push('Add an API key in Settings (sidebar → Settings).')
  }
  if (!settings.modelId.trim()) {
    settingsWarnings.push('Choose a model in Settings.')
  }

  if (
    options.skipSettingsValidation !== true &&
    settingsWarnings.length > 0
  ) {
    throw new Error(settingsWarnings[0])
  }

  const mockAi = isMockAiMode()
  const ctx = options.context
  const isCodeMode = ctx?.agentMode === 'code'

  const history: ModelMessage[] = (options.priorMessages ?? []).map((m) => ({
    role: m.role,
    content: m.content,
  }))
  history.push({ role: 'user', content: options.userText })

  const canvasTools = buildCanvasTools(ctx)
  const codingTools = buildCodingTools(ctx, { lazy: !isCodeMode })
  const switchToCodeTool =
    !isCodeMode ? buildSwitchToCodeAgentTool(ctx) : null
  const tools: Tool[] = [
    ...canvasTools,
    ...codingTools,
    ...(switchToCodeTool ? [switchToCodeTool] : []),
  ]

  const memoryBlock =
    ctx?.workspaceId != null
      ? await loadWorkspaceMemorySystemBlock(ctx.workspaceId)
      : ''
  const cf =
    ctx?.contextFiles != null && ctx.contextFiles.length > 0
      ? contextFilesSystemPrompt(ctx.contextFiles)
      : ''
  const snapshotText =
    ctx?.documentCanvasSnapshot != null
      ? documentCanvasSnapshotPrompt(ctx.documentCanvasSnapshot)
      : ''

  const systemSections: ChatSystemSectionDisplay[] = []

  if (isCodeMode) {
    systemSections.push({
      id: 'primary-code',
      label: 'Code agent',
      source: SOURCE_PRIMARY_CODE,
      text: CODE_AGENT_SYSTEM,
    })
  } else {
    systemSections.push({
      id: 'primary-doc',
      label: 'Document / triage agent',
      source: SOURCE_PRIMARY_DOC,
      text: TRIAGE_SYSTEM,
    })
  }

  if (memoryBlock) {
    systemSections.push({
      id: 'memory',
      label: `Workspace memory (${MEMORY_RELATIVE_PATH})`,
      source: SOURCE_MEMORY,
      text: memoryBlock,
    })
  }

  if (cf) {
    systemSections.push({
      id: 'context-files',
      label: 'Attached workspace files',
      source: SOURCE_CONTEXT_FILES,
      text: cf,
    })
  }

  if (snapshotText) {
    systemSections.push({
      id: 'canvas-snapshot',
      label: 'Document canvas snapshot',
      source: SOURCE_CANVAS_SNAPSHOT,
      text: snapshotText,
    })
  }

  const systemPrompts = systemSections.map((s) => s.text)

  const toolsDisplay = tools.map((t) => toolToDisplayInfo(t))

  const maxIterations =
    tools.length > 0 ? (isCodeMode ? 32 : 24) : null

  return {
    systemSections,
    systemPrompts,
    messages: history,
    tools,
    toolsDisplay,
    provider: settings.provider as AiProviderId,
    modelId: settings.modelId,
    baseUrl: settings.baseUrl,
    apiKey: settings.apiKey.trim(),
    mockAi,
    isCodeMode,
    conversationId:
      ctx?.conversationId != null ? ctx.conversationId : undefined,
    maxIterations,
    settingsWarnings,
  }
}

function messageContentForSnapshot(
  content: ModelMessage['content'],
): string {
  if (typeof content === 'string') return content
  if (content == null) return ''
  try {
    return JSON.stringify(content, null, 2)
  } catch {
    return String(content)
  }
}

export function tanStackTurnArgsToSnapshot(
  args: BuildTanStackChatTurnArgsResult,
  userText: string,
): SerializableModelRequestSnapshot {
  return {
    builtAt: Date.now(),
    userText,
    provider: args.provider,
    modelId: args.modelId,
    mockAi: args.mockAi,
    isCodeMode: args.isCodeMode,
    settingsWarnings: [...args.settingsWarnings],
    systemSections: args.systemSections.map((s) => ({ ...s })),
    messages: args.messages.map((m) => ({
      role: m.role,
      content: messageContentForSnapshot(m.content),
    })),
    tools: args.toolsDisplay.map((t) => ({ ...t })),
  }
}
