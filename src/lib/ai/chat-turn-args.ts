import { z } from 'zod'

import type { AiSettingsDto } from '@/lib/ai-settings-api'
import { aiSettingsGet } from '@/lib/ai-settings-api'
import type { AiProviderId } from '@/lib/ai/model-catalog'
import {
  MEMORY_INJECT_MAX_BYTES,
  MEMORY_RELATIVE_PATH,
} from '@/lib/memory/constants'
import { isNonWorkspaceScopedSessionId } from '@/lib/chat-sessions/detached'
import {
  formatUserProfileForPrompt,
  userProfileGet,
} from '@/lib/user-profile-api'
import { workspaceReadTextFile } from '@/lib/workspace-api'
import {
  formatSkillCatalogSystemText,
  loadAppBuilderSkillMarkdown,
  loadSkillCatalog,
} from '@/lib/skills/load-skill-catalog'

import {
  APP_BUILDER_INSTRUCTIONS_FALLBACK,
  APP_MODE_ROUTING_ADDENDUM,
  buildBraianRoutingPrompt,
  CODE_MODE_ROUTING_ADDENDUM,
  DOC_MODE_ROUTING_ADDENDUM,
} from './braian-routing-prompt'
import { buildCanvasTools } from './canvas-tools'
import { buildCodingTools } from './coding-tools'
import { isMockAiMode } from './mock-mode'
import { buildMcpTools } from './mcp-tools'
import { buildSkillTools } from './skill-tools'
import { buildSwitchToAppBuilderTool } from './switch-app-builder-tool'
import { buildSwitchToCodeAgentTool } from './switch-code-agent-tool'
import { buildUserProfileTools } from './user-profile-tools'
import { buildWorkspaceMemoryTools } from './workspace-memory-tools'
import { buildProviderNativeSearchTools } from './provider-native-search-tools'
import { buildWorkspaceWebappTools } from './webapp-tools'
import { buildReasoningModelOptions } from './reasoning-model-options'
import type { ChatTurnContext, PriorChatMessage, ReasoningMode } from './types'
import type { ReasoningModelOptions } from './reasoning-model-options'

import type { ModelMessage, Tool } from '@tanstack/ai'

/** Fallback webapp instructions if `.braian/skills/app-builder.md` is unavailable. */
export const APP_BUILDER_SYSTEM = APP_BUILDER_INSTRUCTIONS_FALLBACK

export const PROFILE_COACH_SYSTEM = `You are the **profile coach** in Braian Desktop. Your job is to get to know the user in a friendly, efficient way and to keep their **global profile** up to date.

**Behavior:**
- Ask short, natural questions (name, where they are, languages they prefer for answers, timezone or locale if relevant, role or context that helps assistants across workspaces).
- When the user shares something they want remembered, call **update_user_profile** with only the fields that changed. Do not invent facts.
- If they clear or correct something, use the tool with null or empty string for that field, or an updated list for languages.
- You have **no** workspace files, code, document canvas, or webapp tools — only **update_user_profile**. If they ask for other work, say that normal chats in a workspace handle that, and stay focused on profile here.

**Privacy:** Only store what they explicitly give you or clearly confirm.`

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
  reasoningMode: ReasoningMode
  mockAi: boolean
  isCodeMode: boolean
  settingsWarnings: string[]
  systemSections: ChatSystemSectionDisplay[]
  messages: { role: string; content: string }[]
  tools: ChatToolDisplayInfo[]
}

const SOURCE_ROUTING_DOC =
  'src/lib/ai/braian-routing-prompt.ts + chat-turn-args (document mode)'
const SOURCE_ROUTING_CODE =
  'src/lib/ai/braian-routing-prompt.ts + chat-turn-args (code mode)'
const SOURCE_SKILLS_CATALOG = 'src/lib/skills/load-skill-catalog.ts'
const SOURCE_APP_BUILDER =
  'src/lib/skills/load-skill-catalog.ts → app-builder.md (+ APP_BUILDER_INSTRUCTIONS_FALLBACK)'
const SOURCE_MEMORY = `src/lib/ai/chat-turn-args.ts → workspaceReadTextFile (${MEMORY_RELATIVE_PATH})`
const SOURCE_CONTEXT_FILES = 'src/lib/ai/chat-turn-args.ts (contextFilesSystemPrompt)'
const SOURCE_PRIOR_CONVERSATIONS =
  'src/lib/ai/chat-turn-args.ts (priorConversationsSystemPrompt)'
const SOURCE_CANVAS_SNAPSHOT = 'src/lib/ai/chat-turn-args.ts (documentCanvasSnapshotPrompt)'
const SOURCE_USER_CONTEXT = 'src/lib/ai/chat-turn-args.ts (user context + client time)'
const SOURCE_PROFILE_COACH = 'src/lib/ai/chat-turn-args.ts (PROFILE_COACH_SYSTEM)'
const SOURCE_PROFILE_STATE =
  'src/lib/user-profile-api.ts (formatUserProfileForPrompt)'

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function isChatPerfLoggingEnabled(): boolean {
  if (typeof localStorage === 'undefined') return false
  try {
    return localStorage.getItem('braian.chatPerf') === '1'
  } catch {
    return false
  }
}

function logChatPerf(stage: string, startAt: number) {
  if (!isChatPerfLoggingEnabled()) return
  const elapsed = (nowMs() - startAt).toFixed(1)
  console.info(`[braian][chat-perf] ${stage} +${elapsed}ms`)
}

const TOOL_SOURCE_BY_NAME: Record<string, string> = {
  apply_document_canvas_patch: 'src/lib/ai/canvas-tools.ts',
  open_document_canvas: 'src/lib/ai/canvas-tools.ts',
  apply_tabular_canvas: 'src/lib/ai/canvas-tools.ts',
  apply_visual_canvas: 'src/lib/ai/canvas-tools.ts',
  read_workspace_file: 'src/lib/ai/coding-tools.ts',
  write_workspace_file: 'src/lib/ai/coding-tools.ts',
  patch_workspace_file: 'src/lib/ai/coding-tools.ts',
  list_workspace_dir: 'src/lib/ai/coding-tools.ts',
  search_workspace: 'src/lib/ai/coding-tools.ts',
  run_workspace_command: 'src/lib/ai/coding-tools.ts',
  run_workspace_shell: 'src/lib/ai/coding-tools.ts',
  switch_to_code_agent: 'src/lib/ai/switch-code-agent-tool.ts',
  switch_to_app_builder: 'src/lib/ai/switch-app-builder-tool.ts',
  __lazy__tool__discovery__: '@tanstack/ai (lazy tool discovery)',
  init_workspace_webapp: 'src/lib/ai/webapp-tools.ts',
  read_workspace_webapp_dev_logs: 'src/lib/ai/webapp-tools.ts',
  set_workspace_webapp_preview_path: 'src/lib/ai/webapp-tools.ts',
  publish_workspace_webapp: 'src/lib/ai/webapp-tools.ts',
  update_user_profile: 'src/lib/ai/user-profile-tools.ts',
  add_workspace_memory: 'src/lib/ai/workspace-memory-tools.ts',
  list_workspace_skills: 'src/lib/ai/skill-tools.ts',
  read_workspace_skill: 'src/lib/ai/skill-tools.ts',
  write_workspace_skill: 'src/lib/ai/skill-tools.ts',
  web_search: 'src/lib/ai/provider-native-search-tools.ts',
  google_search: 'src/lib/ai/provider-native-search-tools.ts',
}

/** User profile lines plus automatic local time (injected on every default agent turn). */
export function buildUserContextSystemSectionText(now: Date = new Date()): string {
  const profileBlock = formatUserProfileForPrompt(userProfileGet())
  const local = now.toLocaleString(undefined, {
    dateStyle: 'full',
    timeStyle: 'long',
  })
  const iso = now.toISOString()
  return [
    '## User profile (editable in sidebar → You)',
    '',
    profileBlock,
    '',
    '## Current client time (automatic; not a user setting)',
    '',
    `Local: ${local}`,
    `ISO: ${iso}`,
    '',
    'Use the profile and time for tone, locale, scheduling, and recency. Only read the clock aloud when the user asks for the time or date.',
  ].join('\n')
}

export async function loadWorkspaceMemorySystemBlock(
  workspaceId: string,
): Promise<string> {
  if (isNonWorkspaceScopedSessionId(workspaceId)) {
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
    'Attached workspace files for this user message:',
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

export function priorConversationsSystemPrompt(
  convs: NonNullable<ChatTurnContext['contextPriorConversations']>,
): string {
  if (convs.length === 0) return ''
  const lines: string[] = [
    'Transcripts from other chats in this workspace (for reference):',
    '',
  ]
  for (const c of convs) {
    const truncNote = c.truncated
      ? '\n[Note: this conversation was truncated by size limits — only the beginning is included.]\n'
      : ''
    lines.push(
      `--- PRIOR CONVERSATION: ${c.title} (id: ${c.conversationId}) ---`,
    )
    lines.push(c.text)
    lines.push(truncNote + '--- END PRIOR CONVERSATION ---\n')
  }
  return lines.join('\n')
}

/** Soft cap for snapshot size in the system prompt (full body may be larger on disk). */
export const DOCUMENT_CANVAS_SNAPSHOT_MAX_CHARS = 200_000

export function documentCanvasSnapshotPrompt(
  snapshot: NonNullable<ChatTurnContext['documentCanvasSnapshot']>,
): string {
  const titleNote =
    snapshot.title != null && snapshot.title !== ''
      ? `Canvas title: ${snapshot.title}\n\n`
      : ''
  const revisionNote = `Canvas revision: **${snapshot.revision}** — pass this exact integer as \`baseRevision\` to **apply_document_canvas_patch**.\n\n`

  const patchRules = [
    '**Editing rules:** Prefer **apply_document_canvas_patch** with ordered \`{ find, replace }\` steps. Each \`find\` must be an exact substring of the current canvas.',
    'Use **open_document_canvas** only for a full rewrite or major restructuring.',
    'If a **canvas selection** section appears below, limit edits to that region when possible.',
    '',
  ].join('\n')

  let body = snapshot.body
  let truncNote = ''
  if (body.length > DOCUMENT_CANVAS_SNAPSHOT_MAX_CHARS) {
    const fullLen = body.length
    body = body.slice(0, DOCUMENT_CANVAS_SNAPSHOT_MAX_CHARS)
    truncNote = `\n[Note: canvas text truncated here for context (${DOCUMENT_CANVAS_SNAPSHOT_MAX_CHARS.toLocaleString()} of ${fullLen.toLocaleString()} characters). Edits outside the visible prefix may still exist on disk — use unique snippets or ask the user to scroll if a find fails.]\n`
  }

  const selectionNote =
    snapshot.selection?.selectedMarkdown &&
    snapshot.selection.selectedMarkdown.trim() !== ''
      ? [
          '### Canvas selection (user-focused excerpt)',
          snapshot.selection.sectionOnly
            ? 'The user invoked this turn from a **selection in the canvas**. Keep the edit scoped to this region.'
            : 'The user included this excerpt for context.',
          '',
          '```markdown',
          snapshot.selection.selectedMarkdown,
          '```',
          '',
        ].join('\n')
      : ''

  const selectionBinding =
    snapshot.selection?.selectedMarkdown?.trim() &&
    snapshot.selectionUserInstruction?.trim()
      ? [
          '',
          '---',
          '**Canvas selection turn — follow this binding:**',
          "- The user's **latest user message** includes the same excerpt and their instruction; treat them as one request.",
          '- The fenced **Canvas selection** markdown above is the target for pronouns like "this", "it", and "this part".',
          '- Copy the `find` text exactly from that excerpt unless the user explicitly asked to change the whole document.',
          `- **Instruction they typed in the canvas UI:** ${snapshot.selectionUserInstruction.trim()}`,
          '',
        ].join('\n')
      : ''

  return (
    `${titleNote}${revisionNote}${patchRules}Document canvas snapshot (latest markdown from the editor — includes changes not yet saved to the conversation file):\n${truncNote}\n` +
    body
    + (selectionNote ? `\n\n${selectionNote}` : '')
    + selectionBinding
  )
}

function toolSourceModule(name: string): string {
  if (name.startsWith('mcp__')) return 'src/lib/ai/mcp-tools.ts'
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
  /** Defaults to `fast` when omitted (CLI / tests). */
  reasoningMode?: ReasoningMode
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
  reasoningMode: ReasoningMode
  /** Passed to TanStack `chat({ modelOptions })` when defined. */
  modelOptions?: ReasoningModelOptions
}

/** Builds the same logical payload passed to TanStack `chat()` for a turn. */
export async function buildTanStackChatTurnArgs(
  options: BuildTanStackChatTurnArgsOptions,
): Promise<BuildTanStackChatTurnArgsResult> {
  const buildStartAt = nowMs()
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
  const reasoningMode = options.reasoningMode ?? 'fast'
  const modelOptions = buildReasoningModelOptions(
    settings.provider as AiProviderId,
    settings.modelId,
    reasoningMode,
  )

  const history: ModelMessage[] = (options.priorMessages ?? []).map((m) => ({
    role: m.role,
    content: m.content,
  }))
  history.push({ role: 'user', content: options.userText })

  const nativeSearchTools = buildProviderNativeSearchTools({
    provider: settings.provider as AiProviderId,
    modelId: settings.modelId.trim(),
  })

  if (ctx?.turnKind === 'profile') {
    const tools = [...buildUserProfileTools(), ...nativeSearchTools]
    const profileText = formatUserProfileForPrompt(userProfileGet())
    const systemSections: ChatSystemSectionDisplay[] = [
      {
        id: 'profile-coach',
        label: 'Profile coach',
        source: SOURCE_PROFILE_COACH,
        text: PROFILE_COACH_SYSTEM,
      },
      {
        id: 'profile-state',
        label: 'Current user profile (authoritative)',
        source: SOURCE_PROFILE_STATE,
        text: profileText,
      },
    ]
    return {
      systemSections,
      systemPrompts: systemSections.map((s) => s.text),
      messages: history,
      tools,
      toolsDisplay: tools.map((t) => toolToDisplayInfo(t)),
      provider: settings.provider as AiProviderId,
      modelId: settings.modelId,
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey.trim(),
      mockAi,
      isCodeMode: false,
      conversationId: undefined,
      maxIterations: tools.length > 0 ? 16 : null,
      settingsWarnings,
      reasoningMode,
      ...(modelOptions ? { modelOptions } : {}),
    }
  }

  const agentMode = ctx?.agentMode ?? 'document'
  const isAppMode = agentMode === 'app'
  const isCodeMode = agentMode === 'code' || isAppMode

  const canvasTools = buildCanvasTools(ctx)
  const codingTools = buildCodingTools(ctx, { lazy: !isCodeMode })
  const switchToCodeTool =
    agentMode === 'document' ? buildSwitchToCodeAgentTool(ctx) : null
  const switchToAppTool = buildSwitchToAppBuilderTool(ctx)
  const webappTools = buildWorkspaceWebappTools(ctx)
  const skillTools = buildSkillTools(ctx)
  const mcpToolsStart = nowMs()
  const providerId = settings.provider as AiProviderId
  const useLooseMcpForOpenAi =
    providerId === 'openai' || providerId === 'openai_compatible'
  const { tools: mcpTools, warnings: mcpWarnings, serverNames: mcpServerNames } =
    await buildMcpTools(ctx, {
      useLooseMcpInputSchemaForOpenAi: useLooseMcpForOpenAi,
    })
  logChatPerf('buildMcpTools', mcpToolsStart)
  for (const w of mcpWarnings) {
    settingsWarnings.push(w)
  }
  const workspaceMemoryTools =
    ctx?.workspaceId != null &&
    !isNonWorkspaceScopedSessionId(ctx.workspaceId)
      ? buildWorkspaceMemoryTools(ctx)
      : []
  const tools: Tool[] = [
    ...canvasTools,
    ...workspaceMemoryTools,
    ...codingTools,
    ...skillTools,
    ...(switchToCodeTool ? [switchToCodeTool] : []),
    ...(switchToAppTool ? [switchToAppTool] : []),
    ...webappTools,
    ...mcpTools,
    ...nativeSearchTools,
  ]

  const memoryBlockStart = nowMs()
  const memoryBlock =
    ctx?.workspaceId != null
      ? await loadWorkspaceMemorySystemBlock(ctx.workspaceId)
      : ''
  if (ctx?.workspaceId != null) {
    logChatPerf('loadWorkspaceMemorySystemBlock', memoryBlockStart)
  }
  const cf =
    ctx?.contextFiles != null && ctx.contextFiles.length > 0
      ? contextFilesSystemPrompt(ctx.contextFiles)
      : ''
  const pc =
    ctx?.contextPriorConversations != null &&
    ctx.contextPriorConversations.length > 0
      ? priorConversationsSystemPrompt(ctx.contextPriorConversations)
      : ''
  const snapshotText =
    ctx?.documentCanvasSnapshot != null
      ? documentCanvasSnapshotPrompt(ctx.documentCanvasSnapshot)
      : ''

  const systemSections: ChatSystemSectionDisplay[] = []

  const workspaceScoped =
    ctx?.workspaceId != null &&
    !isNonWorkspaceScopedSessionId(ctx.workspaceId)

  const routingText = [
    buildBraianRoutingPrompt({
      hasSwitchToAppBuilder: switchToAppTool != null,
      hasSwitchToCodeAgent: switchToCodeTool != null,
      hasWebappTools: webappTools.length > 0,
      hasCodeTools: codingTools.length > 0,
      hasCanvasTools: canvasTools.length > 0,
      hasCanvasSnapshot: snapshotText.length > 0,
      hasSkillTools: skillTools.length > 0,
      hasMcpTools: mcpTools.length > 0,
      hasProviderWebSearch: nativeSearchTools.length > 0,
      hasWorkspaceMemoryTool: workspaceMemoryTools.length > 0,
      mcpServerNames,
    }),
    isCodeMode ? CODE_MODE_ROUTING_ADDENDUM : DOC_MODE_ROUTING_ADDENDUM,
    ...(isAppMode ? [APP_MODE_ROUTING_ADDENDUM] : []),
  ].join('\n\n')

  if (isCodeMode) {
    systemSections.push({
      id: 'routing-code',
      label: isAppMode ? 'Routing (App agent)' : 'Routing (code agent)',
      source: SOURCE_ROUTING_CODE,
      text: routingText,
    })
  } else {
    systemSections.push({
      id: 'routing-doc',
      label: 'Routing (document / triage)',
      source: SOURCE_ROUTING_DOC,
      text: routingText,
    })
  }

  if (workspaceScoped && ctx.workspaceId != null) {
    const { entries, catalogIncomplete } = await loadSkillCatalog(
      ctx.workspaceId,
    )
    systemSections.push({
      id: 'skills-catalog',
      label: 'Skills catalog',
      source: SOURCE_SKILLS_CATALOG,
      text: formatSkillCatalogSystemText(entries, catalogIncomplete),
    })
  }

  systemSections.push({
    id: 'user-context',
    label: 'User context',
    source: SOURCE_USER_CONTEXT,
    text: buildUserContextSystemSectionText(),
  })

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

  if (pc) {
    systemSections.push({
      id: 'context-prior-conversations',
      label: 'Prior conversations (attached)',
      source: SOURCE_PRIOR_CONVERSATIONS,
      text: pc,
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

  if (
    isAppMode &&
    ctx?.workspaceId != null &&
    !isNonWorkspaceScopedSessionId(ctx.workspaceId)
  ) {
    const appBuilderText = await loadAppBuilderSkillMarkdown(
      ctx.workspaceId,
      APP_BUILDER_INSTRUCTIONS_FALLBACK,
    )
    systemSections.push({
      id: 'app-builder',
      label: 'Workspace webapp builder',
      source: SOURCE_APP_BUILDER,
      text: appBuilderText,
    })
  }

  if (mcpWarnings.length > 0) {
    const mcpIssuesText = mcpWarnings
      .map((w) => `- ${w}`)
      .join('\n')
    systemSections.push({
      id: 'mcp-issues',
      label: 'Connections (MCP) issues',
      source: 'src/lib/ai/chat-turn-args.ts',
      text: `## Connections (MCP) issues\n\nSome MCP connections had problems this turn. Tools from these servers may be unavailable:\n\n${mcpIssuesText}`,
    })
  }

  const systemPrompts = systemSections.map((s) => s.text)

  const toolsDisplay = tools.map((t) => toolToDisplayInfo(t))

  const maxIterations =
    tools.length > 0
      ? (() => {
          let base = isCodeMode ? (isAppMode ? 44 : 40) : 24
          if (mcpTools.length > 0) {
            base = Math.min(base + 8, 48)
          }
          if (nativeSearchTools.length > 0) {
            base = Math.min(base + 4, 48)
          }
          return base
        })()
      : null

  logChatPerf('buildTanStackChatTurnArgs total', buildStartAt)

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
    reasoningMode,
    ...(modelOptions ? { modelOptions } : {}),
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
    reasoningMode: args.reasoningMode,
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
