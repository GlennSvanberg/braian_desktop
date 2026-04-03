import {
  chat,
  maxIterations,
  type AnyTextAdapter,
  type ModelMessage,
} from '@tanstack/ai'
import { createAnthropicChat } from '@tanstack/ai-anthropic'
import { createGeminiChat } from '@tanstack/ai-gemini'
import { createOpenaiChat } from '@tanstack/ai-openai'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'

import { aiSettingsGet } from '@/lib/ai-settings-api'
import type { AiProviderId } from '@/lib/ai/model-catalog'
import { isTauri } from '@/lib/tauri-env'
import type { WorkspaceArtifactPayload } from '@/lib/artifacts/types'

import { buildCanvasTools } from './canvas-tools'
import type {
  ChatStreamChunk,
  ChatTurnContext,
  PriorChatMessage,
} from './types'

const TRIAGE_SYSTEM = `You are Braian, the user's primary assistant in Braian Desktop — a local-first workspace for business users with chat and a workspace panel for documents, data, and visuals.

When the user wants to draft or co-write long-form text (stories, specs, documents) in the workspace canvas, call the tool open_document_canvas with the full markdown. Do not only paste long documents in chat when they asked for the canvas.

If open_document_canvas is not available (unsaved chat), say they need a saved conversation first, then they can ask again.

You may use tools offered in this turn when appropriate. Do not claim to have read arbitrary files or run shell commands unless those tools exist here.`

function resolveFetch(): typeof fetch {
  if (isTauri()) {
    return tauriFetch as unknown as typeof fetch
  }
  return globalThis.fetch.bind(globalThis)
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '')
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

  const canvasTools = buildCanvasTools(context)

  // Dynamic model ids from settings use type assertions; adapters validate at runtime.
  const stream = chat({
    adapter: buildAdapter(
      provider,
      model,
      apiKey,
      settings.baseUrl,
      fetchImpl,
    ) as AnyTextAdapter,
    messages: history,
    systemPrompts: [TRIAGE_SYSTEM],
    abortController: ac,
    conversationId:
      context?.conversationId != null ? context.conversationId : undefined,
    tools: canvasTools.length > 0 ? canvasTools : undefined,
    agentLoopStrategy: canvasTools.length > 0 ? maxIterations(12) : undefined,
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

/** Tauri’s WebView is still a browser context; official SDKs block unless opted in. We only run this path in the desktop app with Tauri HTTP fetch (no public page). */
const desktopBrowserSdkOpts = {
  dangerouslyAllowBrowser: true as const,
}

function buildAdapter(
  provider: AiProviderId,
  model: string,
  apiKey: string,
  baseUrl: string | null,
  fetchImpl: typeof fetch,
) {
  switch (provider) {
    case 'openai':
      return createOpenaiChat(model as never, apiKey, {
        fetch: fetchImpl,
        ...desktopBrowserSdkOpts,
      })
    case 'anthropic':
      return createAnthropicChat(model as never, apiKey, {
        fetch: fetchImpl,
        ...desktopBrowserSdkOpts,
      })
    case 'gemini':
      return createGeminiChat(model as never, apiKey, { fetch: fetchImpl })
    case 'openai_compatible': {
      const url = baseUrl?.trim()
      if (!url) {
        throw new Error('Base URL is required for OpenAI-compatible providers.')
      }
      return createOpenaiChat(model as never, apiKey, {
        baseURL: normalizeBaseUrl(url),
        fetch: fetchImpl,
        ...desktopBrowserSdkOpts,
      })
    }
    default:
      throw new Error(`Unknown provider: ${provider}`)
  }
}
