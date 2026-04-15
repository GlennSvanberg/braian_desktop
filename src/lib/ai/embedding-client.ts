/**
 * Embedding API calls for workspace RAG (provider-native + Anthropic fallback).
 * Uses Tauri HTTP in desktop to avoid CORS issues.
 */
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'

import type { AiSettingsDto } from '@/lib/ai-settings-api'
import type { AiProviderId } from '@/lib/ai/model-catalog'
import { normalizeBaseUrl } from '@/lib/ai/chat-adapter'
import { isTauri } from '@/lib/tauri-env'

export type EmbeddingPurpose = 'document' | 'query'

function httpFetch(): typeof fetch {
  return isTauri() ? tauriFetch : globalThis.fetch.bind(globalThis)
}

const DEFAULT_OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small'
const DEFAULT_GEMINI_EMBEDDING_MODEL = 'text-embedding-004'

export type ResolvedEmbeddingTarget = {
  kind: 'openai' | 'gemini' | 'openai_compatible'
  apiKey: string
  baseUrl: string | null
  model: string
}

/** Resolve which API + model to use for embeddings given chat settings. */
export function resolveEmbeddingTarget(settings: AiSettingsDto): ResolvedEmbeddingTarget | null {
  const custom = settings.embeddingModelId?.trim()
  const fbUrl = settings.embeddingFallbackBaseUrl?.trim()
  const fbKey = settings.embeddingFallbackApiKey?.trim()
  const fbModel = settings.embeddingFallbackModel?.trim()

  if (settings.provider === 'anthropic') {
    if (!fbUrl || !fbKey) {
      return null
    }
    return {
      kind: 'openai_compatible',
      apiKey: fbKey,
      baseUrl: fbUrl,
      model: fbModel || DEFAULT_OPENAI_EMBEDDING_MODEL,
    }
  }

  if (settings.provider === 'openai') {
    return {
      kind: 'openai',
      apiKey: settings.apiKey.trim(),
      baseUrl: null,
      model: custom || DEFAULT_OPENAI_EMBEDDING_MODEL,
    }
  }

  if (settings.provider === 'openai_compatible') {
    const base = settings.baseUrl?.trim()
    if (!base) return null
    return {
      kind: 'openai_compatible',
      apiKey: settings.apiKey.trim(),
      baseUrl: base,
      model: custom || DEFAULT_OPENAI_EMBEDDING_MODEL,
    }
  }

  if (settings.provider === 'gemini') {
    return {
      kind: 'gemini',
      apiKey: settings.apiKey.trim(),
      baseUrl: null,
      model: custom || DEFAULT_GEMINI_EMBEDDING_MODEL,
    }
  }

  return null
}

async function openAiCompatibleEmbeddings(
  target: ResolvedEmbeddingTarget,
  texts: string[],
  purpose: EmbeddingPurpose,
): Promise<number[][]> {
  const fetchImpl = httpFetch()
  const url =
    target.kind === 'openai'
      ? 'https://api.openai.com/v1/embeddings'
      : `${normalizeBaseUrl(target.baseUrl ?? '')}/embeddings`
  const body = {
    model: target.model,
    input: texts.length === 1 ? texts[0] : texts,
  }
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${target.apiKey}`,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`OpenAI embeddings failed (${res.status}): ${t.slice(0, 400)}`)
  }
  const json = (await res.json()) as {
    data?: Array<{ embedding: number[] }>
  }
  const rows = json.data
  if (!rows?.length) {
    throw new Error('OpenAI embeddings: empty response.')
  }
  return rows.map((r) => r.embedding)
}

async function geminiEmbedOne(
  model: string,
  apiKey: string,
  text: string,
  purpose: EmbeddingPurpose,
): Promise<number[]> {
  const fetchImpl = httpFetch()
  const taskType =
    purpose === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT'
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${encodeURIComponent(apiKey)}`
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: { parts: [{ text }] },
      taskType,
    }),
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`Gemini embedding failed (${res.status}): ${t.slice(0, 400)}`)
  }
  const json = (await res.json()) as {
    embedding?: { values?: number[] }
  }
  const v = json.embedding?.values
  if (!v?.length) {
    throw new Error('Gemini embedding: missing values.')
  }
  return v
}

/**
 * Embed one or more texts. For Gemini, calls the API once per text (batching can be added later).
 */
export async function embedTexts(
  settings: AiSettingsDto,
  texts: string[],
  purpose: EmbeddingPurpose,
): Promise<{ vectors: number[][]; modelId: string }> {
  const target = resolveEmbeddingTarget(settings)
  if (!target) {
    throw new Error(
      'Semantic embeddings are not configured. For Anthropic chat, set embedding fallback (OpenAI-compatible URL + API key) in Settings.',
    )
  }
  if (texts.length === 0) {
    return { vectors: [], modelId: target.model }
  }

  if (target.kind === 'gemini') {
    const vectors: number[][] = []
    for (const t of texts) {
      vectors.push(await geminiEmbedOne(target.model, target.apiKey, t, purpose))
    }
    return { vectors, modelId: target.model }
  }

  const vectors = await openAiCompatibleEmbeddings(target, texts, purpose)
  return { vectors, modelId: target.model }
}

export async function embedQueryText(
  settings: AiSettingsDto,
  text: string,
): Promise<{ vector: number[]; modelId: string }> {
  const { vectors, modelId } = await embedTexts(settings, [text], 'query')
  const v = vectors[0]
  if (!v?.length) {
    throw new Error('Embedding returned an empty vector.')
  }
  return { vector: v, modelId }
}

/** Model id stored in SQLite for retrieval rows (must match query embedding). */
export function embeddingModelIdForStorage(settings: AiSettingsDto): string | null {
  const t = resolveEmbeddingTarget(settings)
  return t?.model ?? null
}

export function canEmbed(settings: AiSettingsDto): boolean {
  return resolveEmbeddingTarget(settings) != null
}

export function describeEmbeddingBlocker(
  provider: AiProviderId,
): string | null {
  if (provider === 'anthropic') {
    return 'Set embedding fallback (OpenAI-compatible base URL + API key) in Settings to enable semantic search.'
  }
  return null
}
