import {
  chat,
  maxIterations,
  type AnyTextAdapter,
} from '@tanstack/ai'
import type { AiSettingsDto } from '@/lib/ai-settings-api'
import { isTauri } from '@/lib/tauri-env'

import { braianArtifactFromCustomValue } from './braian-artifact-from-custom'
import {
  buildTanStackChatTurnArgs,
  type BuildTanStackChatTurnArgsResult,
} from './chat-turn-args'
import { buildChatAdapter, resolveFetch } from './chat-adapter'
import type {
  ChatStreamChunk,
  ChatTurnContext,
  PriorChatMessage,
} from './types'

function mergeAbortParent(signal: AbortSignal | undefined): AbortController {
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
  return ac
}

function isChatPerfLoggingEnabled(): boolean {
  if (typeof localStorage === 'undefined') return false
  try {
    return localStorage.getItem('braian.chatPerf') === '1'
  } catch {
    return false
  }
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function logChatPerf(stage: string, startAt: number) {
  if (!isChatPerfLoggingEnabled()) return
  const elapsed = (nowMs() - startAt).toFixed(1)
  console.info(`[braian][chat-perf] ${stage} +${elapsed}ms`)
}

export type IterateTanStackFromArgsOptions = {
  /** Omit tools and agent loop (Node CLI / evaluation without Tauri tool execution). */
  stripTools?: boolean
}

export type StreamTanStackChatTurnOptions = {
  prebuiltArgs?: BuildTanStackChatTurnArgsResult
}

/**
 * Runs TanStack `chat()` for already-built turn args. Shared by the desktop stream and headless CLI.
 */
export async function* iterateTanStackFromArgs(
  args: BuildTanStackChatTurnArgsResult,
  ac: AbortController,
  options?: IterateTanStackFromArgsOptions,
): AsyncGenerator<ChatStreamChunk> {
  const stripTools = options?.stripTools === true
  const tools = stripTools ? [] : args.tools
  const agentLoopCap = stripTools ? null : args.maxIterations

  const fetchImpl = resolveFetch(args.provider)

  const stream = chat({
    adapter: buildChatAdapter(
      args.provider,
      args.modelId,
      args.apiKey,
      args.baseUrl,
      fetchImpl,
    ) as AnyTextAdapter,
    messages: args.messages,
    systemPrompts: args.systemPrompts,
    abortController: ac,
    conversationId: args.conversationId,
    tools: tools.length > 0 ? tools : undefined,
    agentLoopStrategy:
      agentLoopCap != null ? maxIterations(agentLoopCap) : undefined,
    ...(args.modelOptions != null
      ? { modelOptions: args.modelOptions as never }
      : {}),
  })

  try {
    for await (const chunk of stream) {
      if (chunk.type === 'TEXT_MESSAGE_CONTENT') {
        const delta = typeof chunk.delta === 'string' ? chunk.delta : ''
        if (delta) {
          yield { type: 'text-delta', text: delta }
        }
      } else if (chunk.type === 'CUSTOM' && chunk.name === 'braian-artifact') {
        let payload: ReturnType<typeof braianArtifactFromCustomValue> = null
        try {
          payload = braianArtifactFromCustomValue(chunk.value)
        } catch (e) {
          console.error('[braian] braian-artifact payload failed', e)
        }
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
          const rawResult = chunk.result
          const resultStr =
            rawResult === undefined || rawResult === null
              ? undefined
              : typeof rawResult === 'string'
                ? rawResult
                : JSON.stringify(rawResult)
          yield {
            type: 'tool-end',
            toolCallId,
            toolName,
            ...(chunk.input !== undefined ? { input: chunk.input } : {}),
            ...(resultStr !== undefined ? { result: resultStr } : {}),
          }
        }
      } else if (chunk.type === 'STEP_STARTED') {
        const stepId =
          typeof chunk.stepId === 'string' && chunk.stepId
            ? chunk.stepId
            : 'thinking'
        yield { type: 'thinking-start', stepId }
      } else if (chunk.type === 'STEP_FINISHED') {
        const stepId =
          typeof chunk.stepId === 'string' && chunk.stepId
            ? chunk.stepId
            : 'thinking'
        const delta = typeof chunk.delta === 'string' ? chunk.delta : ''
        if (delta) {
          yield { type: 'thinking-delta', stepId, text: delta }
        }
        yield { type: 'thinking-end', stepId }
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

export async function* streamTanStackChatTurn(
  userText: string,
  signal: AbortSignal | undefined,
  context: ChatTurnContext | undefined,
  priorMessages: PriorChatMessage[] | undefined,
  options?: StreamTanStackChatTurnOptions,
): AsyncGenerator<ChatStreamChunk> {
  if (!isTauri()) {
    throw new Error(
      'AI chat requires the Braian desktop app so requests can reach providers without browser CORS limits. Run `npm run tauri:dev`, or use mock mode in dev: localStorage.setItem("braian.mockAi","1").',
    )
  }

  const ac = mergeAbortParent(signal)

  const argsBuildStart = nowMs()
  const args =
    options?.prebuiltArgs ??
    (await buildTanStackChatTurnArgs({
      userText,
      context,
      priorMessages,
      skipSettingsValidation: false,
    }))
  logChatPerf(
    options?.prebuiltArgs ? 'reuse prebuilt turn args' : 'build turn args',
    argsBuildStart,
  )

  yield* iterateTanStackFromArgs(args, ac)
}

export type StreamTanStackChatTurnHeadlessOptions = {
  skipSettingsValidation?: boolean
  /** Default true: workspace tools need Tauri; stripping avoids failed invoke calls in Node. */
  noTools?: boolean
}

/**
 * Same pipeline as the desktop app, for Node-based evaluation (CLI). Requires explicit settings (no SQLite / localStorage).
 */
export async function* streamTanStackChatTurnHeadless(
  userText: string,
  signal: AbortSignal | undefined,
  context: ChatTurnContext | undefined,
  priorMessages: PriorChatMessage[] | undefined,
  settings: AiSettingsDto,
  options?: StreamTanStackChatTurnHeadlessOptions,
): AsyncGenerator<ChatStreamChunk> {
  const ac = mergeAbortParent(signal)
  const noTools = options?.noTools !== false

  const args = await buildTanStackChatTurnArgs({
    userText,
    context,
    priorMessages,
    settings,
    skipSettingsValidation: options?.skipSettingsValidation === true,
  })

  yield* iterateTanStackFromArgs(args, ac, { stripTools: noTools })
}
