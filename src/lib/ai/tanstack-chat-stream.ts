import {
  chat,
  maxIterations,
  type AnyTextAdapter,
  type ModelMessage,
} from '@tanstack/ai'
import { aiSettingsGet } from '@/lib/ai-settings-api'
import type { AiProviderId } from '@/lib/ai/model-catalog'
import type { WorkspaceArtifactPayload } from '@/lib/artifacts/types'
import {
  MEMORY_INJECT_MAX_BYTES,
  MEMORY_RELATIVE_PATH,
} from '@/lib/memory/constants'
import { isTauri } from '@/lib/tauri-env'
import { workspaceReadTextFile } from '@/lib/workspace-api'

import { buildChatAdapter, resolveFetch } from './chat-adapter'
import { buildCanvasTools } from './canvas-tools'
import { buildCodingTools } from './coding-tools'
import { buildSwitchToCodeAgentTool } from './switch-code-agent-tool'
import type {
  ChatStreamChunk,
  ChatTurnContext,
  PriorChatMessage,
} from './types'

const TRIAGE_SYSTEM = `You are Braian, the user's primary assistant in Braian Desktop — a local-first workspace for business users with chat and a workspace panel for documents, data, and visuals.

When the user wants to draft or co-write long-form text (stories, specs, documents) in the workspace canvas, call the tool open_document_canvas with the **complete** markdown for the file after your edits.

If a "Document canvas snapshot" system message is present, it is the **authoritative latest text** (including the user's manual edits). Start from that snapshot, apply only what they asked for, and pass the **full merged** markdown to open_document_canvas—never discard their writing unless they explicitly asked to remove it.

If a "Attached workspace files" system message is present, those excerpts are the **authoritative file contents for this turn** (paths are relative to the workspace root). Large files may be truncated.

**Workspace capabilities:** When the chat is saved you have the document canvas tool. For tasks that need Python, terminal commands, real \`.xlsx\` / files on disk, or reading arbitrary workspace paths, **you** enable code tools: call \`switch_to_code_agent\`, then immediately call \`__lazy__tool__discovery__\` with the toolNames returned by that tool. After that, use read/write/list/run tools — do **not** ask the user to change modes in the UI. Until you complete those steps, do not claim you ran scripts or wrote binary files. You may still draft markdown in the canvas when that alone satisfies the request.

If open_document_canvas is not available (unsaved chat), say they need a saved conversation first, then they can ask again.

You may use tools offered in this turn when appropriate. Do not claim to have read arbitrary files or run shell commands unless those tools exist here or the user attached file content in the system messages above.`

const CODE_AGENT_SYSTEM = `You are a coding-style agent in Braian Desktop (local-first workspace). You can read and write UTF-8 files and run programs **only inside the user's active workspace** via the provided tools.

Workflow (like a CLI coding assistant): understand the task → read or list files as needed → write or update scripts (prefer **Python** for data work: CSV, Excel via pandas/openpyxl, downloads with urllib/requests) → run commands to install deps (e.g. pip/uv) and execute scripts → report stdout/stderr and outcomes honestly.

If the user @-attached a CSV/Excel file, the system message shows its workspace path — use \`read_workspace_file\` on that path (or the excerpt plus write scripts that read it) and produce the requested output file (e.g. \`.xlsx\`) under the workspace with tools, not just prose.

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

async function loadWorkspaceMemorySystemBlock(
  workspaceId: string,
): Promise<string> {
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

function contextFilesSystemPrompt(
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

function documentCanvasSnapshotPrompt(
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

function braianArtifactFromCustomValue(
  value: unknown,
): WorkspaceArtifactPayload | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (v.kind !== 'document' || typeof v.body !== 'string') return null
  return {
    kind: 'document',
    body: v.body,
    ...(typeof v.title === 'string' ? { title: v.title } : {}),
  }
}

export async function* streamTanStackChatTurn(
  userText: string,
  signal: AbortSignal | undefined,
  context: ChatTurnContext | undefined,
  priorMessages: PriorChatMessage[] | undefined,
): AsyncGenerator<ChatStreamChunk> {
  if (!isTauri()) {
    throw new Error(
      'AI chat requires the Braian desktop app so requests can reach providers without browser CORS limits. Run `npm run tauri:dev`, or use mock mode in dev: localStorage.setItem("braian.mockAi","1").',
    )
  }

  const settings = await aiSettingsGet()
  if (!settings.apiKey.trim()) {
    throw new Error('Add an API key in Settings (sidebar → Settings).')
  }
  if (!settings.modelId.trim()) {
    throw new Error('Choose a model in Settings.')
  }

  const fetchImpl = resolveFetch()
  const ac = new AbortController()
  if (signal) {
    if (signal.aborted) {
      ac.abort(signal.reason)
    } else {
      signal.addEventListener('abort', () => ac.abort(signal.reason), {
        once: true,
      })
    }
  }

  const history: ModelMessage[] = (priorMessages ?? []).map((m) => ({
    role: m.role,
    content: m.content,
  }))
  history.push({ role: 'user', content: userText })

  const provider = settings.provider as AiProviderId
  const model = settings.modelId
  const apiKey = settings.apiKey.trim()

  const isCodeMode = context?.agentMode === 'code'
  const canvasTools = buildCanvasTools(context)
  const codingTools = buildCodingTools(context, { lazy: !isCodeMode })
  const switchToCodeTool =
    !isCodeMode ? buildSwitchToCodeAgentTool(context) : null
  const tools = [
    ...canvasTools,
    ...codingTools,
    ...(switchToCodeTool ? [switchToCodeTool] : []),
  ]

  const memoryBlock =
    context?.workspaceId != null
      ? await loadWorkspaceMemorySystemBlock(context.workspaceId)
      : ''
  const memSlice = memoryBlock ? [memoryBlock] : []

  const cf =
    context?.contextFiles != null && context.contextFiles.length > 0
      ? contextFilesSystemPrompt(context.contextFiles)
      : ''
  const snapshotBlock =
    context?.documentCanvasSnapshot != null
      ? [documentCanvasSnapshotPrompt(context.documentCanvasSnapshot)]
      : []
  const systemPrompts = isCodeMode
    ? [CODE_AGENT_SYSTEM, ...memSlice, ...(cf ? [cf] : []), ...snapshotBlock]
    : [TRIAGE_SYSTEM, ...memSlice, ...(cf ? [cf] : []), ...snapshotBlock]

  const agentLoopStrategy =
    tools.length > 0
      ? maxIterations(isCodeMode ? 32 : 24)
      : undefined

  // Dynamic model ids from settings use type assertions; adapters validate at runtime.
  const stream = chat({
    adapter: buildChatAdapter(
      provider,
      model,
      apiKey,
      settings.baseUrl,
      fetchImpl,
    ) as AnyTextAdapter,
    messages: history,
    systemPrompts,
    abortController: ac,
    conversationId:
      context?.conversationId != null ? context.conversationId : undefined,
    tools: tools.length > 0 ? tools : undefined,
    agentLoopStrategy,
  })

  try {
    for await (const chunk of stream) {
      if (chunk.type === 'TEXT_MESSAGE_CONTENT') {
        const delta = typeof chunk.delta === 'string' ? chunk.delta : ''
        if (delta) {
          yield { type: 'text-delta', text: delta }
        }
      } else if (chunk.type === 'CUSTOM' && chunk.name === 'braian-artifact') {
        const payload = braianArtifactFromCustomValue(chunk.value)
        if (payload) {
          yield { type: 'artifact', payload }
        }
      } else if (chunk.type === 'TOOL_CALL_START') {
        const toolCallId =
          typeof chunk.toolCallId === 'string' ? chunk.toolCallId : ''
        const toolName =
          typeof chunk.toolName === 'string' ? chunk.toolName : 'tool'
        if (toolCallId) {
          yield { type: 'tool-start', toolCallId, toolName }
        }
      } else if (chunk.type === 'TOOL_CALL_ARGS') {
        const toolCallId =
          typeof chunk.toolCallId === 'string' ? chunk.toolCallId : ''
        const delta = typeof chunk.delta === 'string' ? chunk.delta : ''
        if (toolCallId && delta) {
          yield { type: 'tool-args-delta', toolCallId, delta }
        }
      } else if (chunk.type === 'TOOL_CALL_END') {
        const toolCallId =
          typeof chunk.toolCallId === 'string' ? chunk.toolCallId : ''
        const toolName =
          typeof chunk.toolName === 'string' ? chunk.toolName : 'tool'
        if (toolCallId) {
          yield {
            type: 'tool-end',
            toolCallId,
            toolName,
            ...(chunk.input !== undefined ? { input: chunk.input } : {}),
            ...(typeof chunk.result === 'string'
              ? { result: chunk.result }
              : {}),
          }
        }
      } else if (chunk.type === 'RUN_ERROR') {
        const msg = chunk.error?.message ?? 'The model returned an error.'
        throw new Error(msg)
      }
    }
  } catch (e) {
    console.error('[braian] TanStack AI stream error', e)
    throw e
  }

  yield { type: 'done' }
}
