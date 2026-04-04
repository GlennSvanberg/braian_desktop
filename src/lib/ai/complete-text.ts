import { chat, type AnyTextAdapter, type ModelMessage } from '@tanstack/ai'

import { aiSettingsGet } from '@/lib/ai-settings-api'
import type { AiProviderId } from '@/lib/ai/model-catalog'
import { isTauri } from '@/lib/tauri-env'

import { buildChatAdapter, resolveFetch } from './chat-adapter'

/**
 * Single user turn, no tools — collects full assistant text (for memory review, etc.).
 */
export async function completeChatText(options: {
  systemPrompts: string[]
  userMessage: string
  signal?: AbortSignal
}): Promise<string> {
  if (!isTauri()) {
    throw new Error('completeChatText requires the desktop app.')
  }

  const settings = await aiSettingsGet()
  if (!settings.apiKey.trim()) {
    throw new Error('Add an API key in Settings.')
  }
  if (!settings.modelId.trim()) {
    throw new Error('Choose a model in Settings.')
  }

  const fetchImpl = resolveFetch()
  const ac = new AbortController()
  if (options.signal) {
    if (options.signal.aborted) {
      ac.abort(options.signal.reason)
    } else {
      options.signal.addEventListener('abort', () => ac.abort(options.signal!.reason), {
        once: true,
      })
    }
  }

  const provider = settings.provider as AiProviderId
  const messages: ModelMessage[] = [
    { role: 'user', content: options.userMessage },
  ]

  const stream = chat({
    adapter: buildChatAdapter(
      provider,
      settings.modelId,
      settings.apiKey.trim(),
      settings.baseUrl,
      fetchImpl,
    ) as AnyTextAdapter,
    messages,
    systemPrompts: options.systemPrompts,
    abortController: ac,
  })

  let out = ''
  for await (const chunk of stream) {
    if (chunk.type === 'TEXT_MESSAGE_CONTENT') {
      const delta = typeof chunk.delta === 'string' ? chunk.delta : ''
      if (delta) out += delta
    } else if (chunk.type === 'RUN_ERROR') {
      throw new Error(chunk.error?.message ?? 'The model returned an error.')
    }
  }
  return out
}
