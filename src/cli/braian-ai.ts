/**
 * Dev-only CLI: dump built model request (JSON) or stream one headless turn (Node fetch).
 * See --help. Does not ship in the Tauri bundle unless imported from app code.
 */
import { readFileSync } from 'node:fs'
import { stdin } from 'node:process'

import { z } from 'zod'

import {
  CONTEXT_MAX_HISTORY_TOKENS_DEFAULT,
  type AiSettingsDto,
} from '@/lib/ai-settings-api'
import type { AiProviderId } from '@/lib/ai/model-catalog'
import { defaultModelForProvider } from '@/lib/ai/model-catalog'
import {
  buildTanStackChatTurnArgs,
  tanStackTurnArgsToSnapshot,
} from '@/lib/ai/chat-turn-args'
import { streamTanStackChatTurnHeadless } from '@/lib/ai/tanstack-chat-stream'
import type { ChatTurnContext, PriorChatMessage } from '@/lib/ai/types'
import { PERSONAL_WORKSPACE_SESSION_ID } from '@/lib/chat-sessions/detached'
import { deriveAgentModeFromPersisted } from '@/lib/workspace-api'

const PROVIDER_IDS = [
  'openai',
  'anthropic',
  'gemini',
  'openai_compatible',
] as const satisfies readonly AiProviderId[]

function isProviderId(s: string): s is AiProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(s)
}

const contextFileEntrySchema = z.object({
  relativePath: z.string(),
  displayName: z.string().optional(),
  text: z.string(),
  fileTruncated: z.boolean().optional(),
})

const documentCanvasSnapshotSchema = z
  .object({
    body: z.string(),
    title: z.string().optional(),
    revision: z.number().int().optional(),
    selectionUserInstruction: z.string().optional(),
    selection: z
      .object({
        selectedMarkdown: z.string(),
        sectionOnly: z.boolean().optional(),
      })
      .optional(),
  })
  .transform((s) => ({
    ...s,
    revision: s.revision ?? 0,
  }))

const chatTurnContextSchema = z
  .object({
    workspaceId: z.string(),
    conversationId: z.string().nullable(),
    turnKind: z.enum(['default', 'profile']).optional(),
    agentMode: z.enum(['document', 'code', 'app']).optional(),
    /** Legacy: merged into \`agentMode\` via deriveAgentModeFromPersisted. */
    appHarnessEnabled: z.boolean().optional(),
    documentCanvasSnapshot: z
      .union([documentCanvasSnapshotSchema, z.null()])
      .optional(),
    contextFiles: z.array(contextFileEntrySchema).optional(),
  })
  .transform((d) => {
    const { appHarnessEnabled: _h, ...rest } = d
    return {
      ...rest,
      agentMode: deriveAgentModeFromPersisted(d.agentMode, d.appHarnessEnabled),
    }
  })

const priorMessagesSchema = z.array(
  z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string(),
  }),
)

type CliOpts = {
  user?: string
  contextPath?: string
  historyPath?: string
  allowIncompleteSettings?: boolean
  tools?: boolean
  trace?: boolean
}

function die(msg: string): never {
  console.error(msg)
  process.exit(1)
}

function printHelp(): void {
  console.log(`braian-ai — headless AI pipeline evaluation (dev CLI)

Usage:
  npx tsx src/cli/braian-ai.ts dump-request [options]
  npx tsx src/cli/braian-ai.ts stream [options]
  npm run ai:dump -- --user "..."   (same; pass flags after --)
  npm run ai:stream -- --user "..."

Commands:
  dump-request   Print JSON snapshot of system sections, messages, and tool metadata (no network).
  stream         Call the configured provider once from Node (default: tools stripped).

Environment (mirrors app settings):
  BRAIAN_AI_PROVIDER     openai | anthropic | gemini | openai_compatible (default: openai)
  BRAIAN_AI_API_KEY      Required for stream unless evaluating dump-only with allowances.
  BRAIAN_AI_MODEL        Default: first model for provider.
  BRAIAN_AI_BASE_URL     Required when provider is openai_compatible.

Options:
  --user <text>|-        User message. Use - to read stdin.
  --context <path>       JSON file: ChatTurnContext fields (workspaceId, conversationId, …).
  --history <path>       JSON array: { "role": "user"|"assistant", "content": string }[]
  --allow-incomplete-settings   dump-request only: allow missing API key / model (still builds args).

stream only:
  --tools                Register tools with the model (workspace tools need Tauri; will fail in Node).
  --trace                Log each stream chunk as one JSON line on stderr.

If --context is omitted, uses simple-chats workspace (${PERSONAL_WORKSPACE_SESSION_ID}), no conversation.
`)
}

function parseCli(argv: string[]): {
  cmd: 'dump-request' | 'stream' | 'help'
  opts: CliOpts
} {
  const opts: CliOpts = {}
  if (argv.length === 0) return { cmd: 'help', opts }
  const first = argv[0]
  if (first === '--help' || first === '-h') return { cmd: 'help', opts }
  if (first !== 'dump-request' && first !== 'stream') {
    return { cmd: 'help', opts }
  }
  const cmd = first
  let i = 1
  while (i < argv.length) {
    const a = argv[i++]
    if (a === '--help' || a === '-h') return { cmd: 'help', opts }
    if (a === '--user') {
      if (i >= argv.length) die('--user requires a value')
      opts.user = argv[i++]
      continue
    }
    if (a === '--context') {
      if (i >= argv.length) die('--context requires a path')
      opts.contextPath = argv[i++]
      continue
    }
    if (a === '--history') {
      if (i >= argv.length) die('--history requires a path')
      opts.historyPath = argv[i++]
      continue
    }
    if (a === '--allow-incomplete-settings') {
      opts.allowIncompleteSettings = true
      continue
    }
    if (a === '--tools') {
      opts.tools = true
      continue
    }
    if (a === '--trace') {
      opts.trace = true
      continue
    }
    die(`Unknown argument: ${a}`)
  }
  return { cmd, opts }
}

function readJsonFile(path: string, label: string): unknown {
  try {
    const raw = readFileSync(path, 'utf8')
    return JSON.parse(raw) as unknown
  } catch (e) {
    die(`${label}: failed to read ${path}: ${e instanceof Error ? e.message : e}`)
  }
}

function parseContext(path: string | undefined): ChatTurnContext {
  if (!path) {
    return {
      workspaceId: PERSONAL_WORKSPACE_SESSION_ID,
      conversationId: null,
      agentMode: 'document',
    }
  }
  const parsed = chatTurnContextSchema.safeParse(
    readJsonFile(path, '--context'),
  )
  if (!parsed.success) {
    die(`--context: invalid JSON: ${z.prettifyError(parsed.error)}`)
  }
  return parsed.data as ChatTurnContext
}

function parseHistory(path: string | undefined): PriorChatMessage[] {
  if (!path) return []
  const parsed = priorMessagesSchema.safeParse(
    readJsonFile(path, '--history'),
  )
  if (!parsed.success) {
    die(`--history: invalid JSON: ${z.prettifyError(parsed.error)}`)
  }
  return parsed.data
}

function settingsFromEnv(): AiSettingsDto {
  const rawProvider = process.env.BRAIAN_AI_PROVIDER?.trim() ?? 'openai'
  const provider: AiProviderId = isProviderId(rawProvider)
    ? rawProvider
    : 'openai'
  const modelRaw = process.env.BRAIAN_AI_MODEL?.trim()
  return {
    provider,
    apiKey: process.env.BRAIAN_AI_API_KEY?.trim() ?? '',
    modelId: modelRaw && modelRaw.length > 0 ? modelRaw : defaultModelForProvider(provider),
    baseUrl: process.env.BRAIAN_AI_BASE_URL?.trim()
      ? process.env.BRAIAN_AI_BASE_URL.trim()
      : null,
    /** CLI does not apply on-disk compaction; `buildTanStackChatTurnArgs` only uses this for budgeting if wired. */
    contextMaxHistoryTokens: CONTEXT_MAX_HISTORY_TOKENS_DEFAULT,
  }
}

async function readUserText(userFlag: string | undefined): Promise<string> {
  if (userFlag === undefined) die('Missing required --user <text> or --user -')
  if (userFlag === '-') {
    const chunks: Buffer[] = []
    for await (const chunk of stdin) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    return Buffer.concat(chunks).toString('utf8').trimEnd()
  }
  return userFlag
}

function validateStreamSettings(s: AiSettingsDto): void {
  if (!s.apiKey.trim()) die('stream: set BRAIAN_AI_API_KEY')
  if (!s.modelId.trim()) die('stream: set BRAIAN_AI_MODEL (or a valid default)')
  if (s.provider === 'openai_compatible' && !s.baseUrl?.trim()) {
    die('stream: openai_compatible requires BRAIAN_AI_BASE_URL')
  }
}

async function cmdDump(opts: CliOpts): Promise<void> {
  const userText = await readUserText(opts.user)
  const context = parseContext(opts.contextPath)
  const priorMessages = parseHistory(opts.historyPath)
  const settings = settingsFromEnv()
  const args = await buildTanStackChatTurnArgs({
    userText,
    context,
    priorMessages,
    settings,
    skipSettingsValidation: opts.allowIncompleteSettings === true,
  })
  if (!opts.allowIncompleteSettings && args.settingsWarnings.length > 0) {
    die(args.settingsWarnings.join('\n'))
  }
  const snap = tanStackTurnArgsToSnapshot(args, userText)
  console.log(JSON.stringify(snap, null, 2))
}

async function cmdStream(opts: CliOpts): Promise<void> {
  const userText = await readUserText(opts.user)
  const context = parseContext(opts.contextPath)
  const priorMessages = parseHistory(opts.historyPath)
  const settings = settingsFromEnv()
  validateStreamSettings(settings)
  if (opts.tools === true) {
    console.error(
      '[braian-ai] --tools: workspace tools invoke Tauri; expect failures under Node unless only profile tools run.',
    )
  }
  const noTools = opts.tools !== true
  try {
    for await (const chunk of streamTanStackChatTurnHeadless(
      userText,
      undefined,
      context,
      priorMessages,
      settings,
      { skipSettingsValidation: false, noTools },
    )) {
      if (opts.trace) {
        console.error(JSON.stringify(chunk))
      }
      if (chunk.type === 'text-delta') {
        process.stdout.write(chunk.text)
      }
    }
    if (!opts.trace) process.stdout.write('\n')
  } catch (e) {
    die(e instanceof Error ? e.message : String(e))
  }
}

async function main(): Promise<void> {
  const { cmd, opts } = parseCli(process.argv.slice(2))
  if (cmd === 'help') {
    printHelp()
    process.exit(0)
  }
  if (cmd === 'dump-request') {
    if (opts.tools || opts.trace) {
      die('--tools and --trace apply only to stream')
    }
    await cmdDump(opts)
    return
  }
  if (cmd === 'stream') {
    if (opts.allowIncompleteSettings) {
      die('--allow-incomplete-settings applies only to dump-request')
    }
    await cmdStream(opts)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
