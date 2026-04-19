import { chat, type AnyTextAdapter } from '@tanstack/ai'

import { aiSettingsGet } from '@/lib/ai-settings-api'
import { buildChatAdapter } from '@/lib/ai/chat-adapter'
import type { AiProviderId } from '@/lib/ai/model-catalog'
import type {
  ChatStreamChunk,
  ChatTurnContext,
  PriorChatMessage,
} from '@/lib/ai/types'

import { isCloudAuthenticated } from './auth-state'
import { isCloudConfigured } from './convex-client'
import { buildCloudProxyFetch } from './provider-proxy-fetch'

/**
 * Minimal browser chat path used when running outside Tauri.
 *
 * Scope (V1, matches the plan):
 * - Text-only conversation. No tools, no MCP, no skills, no workspace files.
 * - Requires the user to be signed in to Convex Auth and to have stored an
 *   API key for the active provider in the cloud sync card.
 * - Routes the upstream call via `/provider-proxy/<provider>/...` so the
 *   browser never sees the API key and CORS is handled server-side.
 *
 * The desktop path (`streamTanStackChatTurn`) is unchanged; this file only
 * exists to keep the web build small (no Tauri-only modules pulled in).
 */

export type CloudChatTurnInput = {
  userText: string
  signal: AbortSignal | undefined
  context: ChatTurnContext | undefined
  priorMessages: PriorChatMessage[] | undefined
}

const SYSTEM_PROMPT_FALLBACK =
  'You are Braian, a helpful AI assistant. The user is chatting with you from the Braian web app, which is a lightweight cloud-synced view. Workspace files, tools, and integrations are not available in this session — focus on conversational answers.'

/** Throwable that the chat-sessions store turns into the rendered error line. */
class CloudChatGuardError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CloudChatGuardError'
  }
}

function ensureCloudReady(): void {
  if (!isCloudConfigured()) {
    throw new CloudChatGuardError(
      'Cloud sync is not configured (VITE_CONVEX_URL is unset).',
    )
  }
  if (!isCloudAuthenticated()) {
    throw new CloudChatGuardError(
      'Sign in via the Cloud sync card to chat from the web client.',
    )
  }
}

export async function* streamCloudChatTurn(
  input: CloudChatTurnInput,
): AsyncGenerator<ChatStreamChunk> {
  ensureCloudReady()

  const settings = await aiSettingsGet()
  const provider = settings.provider as AiProviderId
  if (provider === 'openai_compatible') {
    throw new CloudChatGuardError(
      'OpenAI-compatible custom endpoints are not available in the web client. Pick OpenAI, Anthropic, or Gemini in Settings.',
    )
  }
  const modelId = settings.modelId.trim()
  if (!modelId) {
    throw new CloudChatGuardError(
      'Choose a model in Settings before chatting from the web.',
    )
  }

  const ac = new AbortController()
  if (input.signal) {
    if (input.signal.aborted) ac.abort(input.signal.reason)
    else input.signal.addEventListener('abort', () => ac.abort(input.signal?.reason), { once: true })
  }

  const messages = (input.priorMessages ?? []).map((m) => ({
    role: m.role,
    content: m.content,
  }))
  messages.push({ role: 'user', content: input.userText })

  // Pass an empty key string; the proxy fetch ignores SDK-set headers and
  // injects the real key server-side from the user's encrypted record.
  const fetchImpl = buildCloudProxyFetch(provider)
  const adapter = buildChatAdapter(
    provider,
    modelId,
    'cloud-proxy-placeholder',
    settings.baseUrl,
    fetchImpl,
  ) as AnyTextAdapter

  const stream = chat({
    adapter,
    messages,
    systemPrompts: [SYSTEM_PROMPT_FALLBACK],
    abortController: ac,
    conversationId: input.context?.conversationId ?? undefined,
  })

  try {
    for await (const chunk of stream) {
      if (chunk.type === 'TEXT_MESSAGE_CONTENT') {
        const delta = typeof chunk.delta === 'string' ? chunk.delta : ''
        if (delta) yield { type: 'text-delta', text: delta }
      } else if (chunk.type === 'RUN_ERROR') {
        const msg = chunk.error?.message ?? 'The model returned an error.'
        throw new Error(msg)
      }
      // Tool / artifact / thinking events are intentionally ignored here:
      // the web build doesn't ship the tool catalog, so the model cannot
      // emit them (and if some provider sends a stray one, we drop it).
    }
  } catch (err) {
    console.error('[braian/cloud] chat stream error', err)
    throw err
  }

  yield { type: 'done' }
}
