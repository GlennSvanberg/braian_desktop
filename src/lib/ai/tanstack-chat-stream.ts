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

When the user wants to draft or co-write long-form text (stories, specs, documents) in the workspace canvas, call the tool open_document_canvas with the **complete** markdown for the file after your edits.

If a "Document canvas snapshot" system message is present, it is the **authoritative latest text** (including the user's manual edits). Start from that snapshot, apply only what they asked for, and pass the **full merged** markdown to open_document_canvas—never discard their writing unless they explicitly asked to remove it.

If a "Attached workspace files" system message is present, those excerpts are the **authoritative file contents for this turn** (paths are relative to the workspace root). Large files may be truncated.

If open_document_canvas is not available (unsaved chat), say they need a saved conversation first, then they can ask again.

You may use tools offered in this turn when appropriate. Do not claim to have read arbitrary files or run shell commands unless those tools exist here or the user attached file content in the system messages above.`

function resolveFetch(): typeof fetch {
  if (isTauri()) {
    return tauriFetch as unknown as typeof fetch
  }
  return globalThis.fetch.bind(globalThis)
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '')
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

  const canvasTools = buildCanvasTools(context)

  const cf =
    context?.contextFiles != null && context.contextFiles.length > 0
      ? contextFilesSystemPrompt(context.contextFiles)
      : ''
  const systemPrompts = [
    TRIAGE_SYSTEM,
    ...(cf ? [cf] : []),
    ...(context?.documentCanvasSnapshot != null
      ? [documentCanvasSnapshotPrompt(context.documentCanvasSnapshot)]
      : []),
  ]

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
    systemPrompts,
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
