import {
  chat,
  maxIterations,
  type AnyTextAdapter,
} from '@tanstack/ai'
import type { WorkspaceArtifactPayload } from '@/lib/artifacts/types'
import { isTauri } from '@/lib/tauri-env'

import { buildTanStackChatTurnArgs } from './chat-turn-args'
import { buildChatAdapter, resolveFetch } from './chat-adapter'
import type {
  ChatStreamChunk,
  ChatTurnContext,
  PriorChatMessage,
} from './types'

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

  const args = await buildTanStackChatTurnArgs({
    userText,
    context,
    priorMessages,
    skipSettingsValidation: false,
  })

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
    tools: args.tools.length > 0 ? args.tools : undefined,
    agentLoopStrategy:
      args.maxIterations != null
        ? maxIterations(args.maxIterations)
        : undefined,
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
