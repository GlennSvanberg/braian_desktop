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
import { EMBEDDED_CREATE_SKILL_MARKDOWN } from '@/lib/skills/embedded-create-skill'
import {
  formatSkillCatalogSystemText,
  loadAppBuilderSkillMarkdown,
  loadCreateSkillBodyMarkdown,
  loadSkillCatalog,
} from '@/lib/skills/load-skill-catalog'

import {
  APP_BUILDER_INSTRUCTIONS_FALLBACK,
  BRAIAN_ROUTING_TREE,
  CODE_MODE_ROUTING_ADDENDUM,
  DOC_MODE_ROUTING_ADDENDUM,
} from './braian-routing-prompt'
import { buildCanvasTools } from './canvas-tools'
import { buildCodingTools } from './coding-tools'
import { buildDashboardTools } from './dashboard-tools'
import { isMockAiMode } from './mock-mode'
import { buildMcpTools } from './mcp-tools'
import { buildSkillTools } from './skill-tools'
import { buildSwitchToAppBuilderTool } from './switch-app-builder-tool'
import { buildSwitchToCodeAgentTool } from './switch-code-agent-tool'
import { buildUserProfileTools } from './user-profile-tools'
import type { ChatTurnContext, PriorChatMessage } from './types'

import type { ModelMessage, Tool } from '@tanstack/ai'

/** Composed document-mode system text (routing + doc addendum). */
export const TRIAGE_SYSTEM = `${BRAIAN_ROUTING_TREE}\n\n${DOC_MODE_ROUTING_ADDENDUM}`

/** Composed code-mode system text (routing + code addendum). */
export const CODE_AGENT_SYSTEM = `${BRAIAN_ROUTING_TREE}\n\n${CODE_MODE_ROUTING_ADDENDUM}`

/** Fallback dashboard instructions if `.braian/skills/app-builder.md` is unavailable. */
export const APP_BUILDER_SYSTEM = APP_BUILDER_INSTRUCTIONS_FALLBACK

export const PROFILE_COACH_SYSTEM = `You are the **profile coach** in Braian Desktop. Your job is to get to know the user in a friendly, efficient way and to keep their **global profile** up to date.

**Behavior:**
- Ask short, natural questions (name, where they are, languages they prefer for answers, timezone or locale if relevant, role or context that helps assistants across workspaces).
- When the user shares something they want remembered, call **update_user_profile** with only the fields that changed. Do not invent facts.
- If they clear or correct something, use the tool with null or empty string for that field, or an updated list for languages.
- Remind them they can return to **sidebar → You** anytime to update who they are.
- You have **no** workspace files, code, document canvas, or dashboard tools — only **update_user_profile**. If they ask for other work, say that normal chats in a workspace handle that, and stay focused on profile here.

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
const SOURCE_SKILLS_CREATE =
  'src/lib/skills/load-skill-catalog.ts → create-skill.md (+ embedded fallback)'
const SOURCE_SKILLS_CATALOG = 'src/lib/skills/load-skill-catalog.ts'
const SOURCE_APP_BUILDER =
  'src/lib/skills/load-skill-catalog.ts → app-builder.md (+ APP_BUILDER_INSTRUCTIONS_FALLBACK)'
const SOURCE_MEMORY = `src/lib/ai/chat-turn-args.ts → workspaceReadTextFile (${MEMORY_RELATIVE_PATH})`
const SOURCE_CONTEXT_FILES = 'src/lib/ai/chat-turn-args.ts (contextFilesSystemPrompt)'
const SOURCE_CANVAS_SNAPSHOT = 'src/lib/ai/chat-turn-args.ts (documentCanvasSnapshotPrompt)'
const SOURCE_USER_CONTEXT = 'src/lib/ai/chat-turn-args.ts (user context + client time)'
const SOURCE_PROFILE_COACH = 'src/lib/ai/chat-turn-args.ts (PROFILE_COACH_SYSTEM)'
const SOURCE_PROFILE_STATE =
  'src/lib/user-profile-api.ts (formatUserProfileForPrompt)'

const TOOL_SOURCE_BY_NAME: Record<string, string> = {
  open_document_canvas: 'src/lib/ai/canvas-tools.ts',
  read_workspace_file: 'src/lib/ai/coding-tools.ts',
  write_workspace_file: 'src/lib/ai/coding-tools.ts',
  list_workspace_dir: 'src/lib/ai/coding-tools.ts',
  run_workspace_command: 'src/lib/ai/coding-tools.ts',
  switch_to_code_agent: 'src/lib/ai/switch-code-agent-tool.ts',
  switch_to_app_builder: 'src/lib/ai/switch-app-builder-tool.ts',
  __lazy__tool__discovery__: '@tanstack/ai (lazy tool discovery)',
  read_workspace_dashboard: 'src/lib/ai/dashboard-tools.ts',
  apply_workspace_dashboard: 'src/lib/ai/dashboard-tools.ts',
  upsert_workspace_page: 'src/lib/ai/dashboard-tools.ts',
  update_user_profile: 'src/lib/ai/user-profile-tools.ts',
  list_workspace_skills: 'src/lib/ai/skill-tools.ts',
  read_workspace_skill: 'src/lib/ai/skill-tools.ts',
  write_workspace_skill: 'src/lib/ai/skill-tools.ts',
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
    'Use the profile and time for tone, locale, scheduling, and recency. Do not read the clock aloud unless the user asks for the time or date.',
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

  const history: ModelMessage[] = (options.priorMessages ?? []).map((m) => ({
    role: m.role,
    content: m.content,
  }))
  history.push({ role: 'user', content: options.userText })

  if (ctx?.turnKind === 'profile') {
    const tools = buildUserProfileTools()
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
    }
  }

  const isCodeMode = ctx?.agentMode === 'code'

  const canvasTools = buildCanvasTools(ctx)
  const codingTools = buildCodingTools(ctx, { lazy: !isCodeMode })
  const switchToCodeTool =
    !isCodeMode ? buildSwitchToCodeAgentTool(ctx) : null
  const switchToAppTool = buildSwitchToAppBuilderTool(ctx)
  const dashboardTools = buildDashboardTools(ctx)
  const skillTools = buildSkillTools(ctx)
  const { tools: mcpTools, warnings: mcpWarnings } = await buildMcpTools(ctx)
  for (const w of mcpWarnings) {
    settingsWarnings.push(w)
  }
  const tools: Tool[] = [
    ...canvasTools,
    ...codingTools,
    ...skillTools,
    ...(switchToCodeTool ? [switchToCodeTool] : []),
    ...(switchToAppTool ? [switchToAppTool] : []),
    ...dashboardTools,
    ...mcpTools,
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
      id: 'routing-code',
      label: 'Routing (code agent)',
      source: SOURCE_ROUTING_CODE,
      text: CODE_AGENT_SYSTEM,
    })
  } else {
    systemSections.push({
      id: 'routing-doc',
      label: 'Routing (document / triage)',
      source: SOURCE_ROUTING_DOC,
      text: TRIAGE_SYSTEM,
    })
  }

  const workspaceScoped =
    ctx?.workspaceId != null &&
    !isNonWorkspaceScopedSessionId(ctx.workspaceId)

  if (workspaceScoped && ctx.workspaceId != null) {
    const createBody = await loadCreateSkillBodyMarkdown(
      ctx.workspaceId,
      EMBEDDED_CREATE_SKILL_MARKDOWN,
    )
    systemSections.push({
      id: 'skills-create',
      label: 'Skill — create-skill (always)',
      source: SOURCE_SKILLS_CREATE,
      text: [
        '## create-skill',
        '',
        'Always follow these instructions when creating or editing skills under `.braian/skills/`:',
        '',
        createBody,
      ].join('\n'),
    })

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

  if (snapshotText) {
    systemSections.push({
      id: 'canvas-snapshot',
      label: 'Document canvas snapshot',
      source: SOURCE_CANVAS_SNAPSHOT,
      text: snapshotText,
    })
  }

  if (
    ctx?.appHarnessEnabled === true &&
    ctx.workspaceId != null &&
    !isNonWorkspaceScopedSessionId(ctx.workspaceId)
  ) {
    const appBuilderText = await loadAppBuilderSkillMarkdown(
      ctx.workspaceId,
      APP_BUILDER_INSTRUCTIONS_FALLBACK,
    )
    systemSections.push({
      id: 'app-builder',
      label: 'Workspace dashboard builder',
      source: SOURCE_APP_BUILDER,
      text: appBuilderText,
    })
  }

  const systemPrompts = systemSections.map((s) => s.text)

  const toolsDisplay = tools.map((t) => toolToDisplayInfo(t))

  const maxIterations =
    tools.length > 0
      ? (() => {
          let base = isCodeMode
            ? 32
            : dashboardTools.length > 0
              ? 28
              : 24
          if (mcpTools.length > 0) {
            base = Math.min(base + 8, 40)
          }
          return base
        })()
      : null

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
