import { chat, type ModelMessage } from '@tanstack/ai'
import { createAnthropicChat } from '@tanstack/ai-anthropic'
import { createGeminiChat } from '@tanstack/ai-gemini'
import { createOpenaiChat } from '@tanstack/ai-openai'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'

import { aiSettingsGet } from '@/lib/ai-settings-api'
import type { AiProviderId } from '@/lib/ai/model-catalog'
import { isTauri } from '@/lib/tauri-env'

import type {
  ChatStreamChunk,
  ChatTurnContext,
  PriorChatMessage,
} from './types'

const TRIAGE_SYSTEM = `You are Braian, the user's primary assistant in Braian Desktop — a local-first workspace for business users with chat and a workspace panel for documents, data, and visuals.

You are the main triage agent: answer helpfully and concisely. Specialized sub-agents will handle deep coding, document editing, and data workflows later; for now you respond directly.

Do not claim to have read files, run commands, or used tools unless the app has explicitly given you that capability in this turn.`

function resolveFetch(): typeof fetch {
  if (isTauri()) {
    return tauriFetch as unknown as typeof fetch
  }
  return globalThis.fetch.bind(globalThis)
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '')
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

  // Dynamic model ids from settings use type assertions; adapters validate at runtime.
  const stream = chat({
    adapter: buildAdapter(provider, model, apiKey, settings.baseUrl, fetchImpl),
    messages: history,
    systemPrompts: [TRIAGE_SYSTEM],
    abortController: ac,
    conversationId:
      context?.conversationId != null ? context.conversationId : undefined,
  })

  try {
    for await (const chunk of stream) {
      if (chunk.type === 'TEXT_MESSAGE_CONTENT') {
        const delta = typeof chunk.delta === 'string' ? chunk.delta : ''
        if (delta) {
          yield { type: 'text-delta', text: delta }
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
