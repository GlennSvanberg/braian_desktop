import { invoke } from '@tauri-apps/api/core'

import {
  type AiProviderId,
  defaultModelForProvider,
} from '@/lib/ai/model-catalog'
import { isTauri } from '@/lib/tauri-env'

const LS_KEY = 'braian.io.aiSettings.v1'

/** Min/max for `contextMaxHistoryTokens` (must match Rust `ai_settings_set`). */
export const CONTEXT_MAX_HISTORY_TOKENS_MIN = 4096
export const CONTEXT_MAX_HISTORY_TOKENS_MAX = 524_288
export const CONTEXT_MAX_HISTORY_TOKENS_DEFAULT = 65_536

/** Min/max for retrieved context section (must match Rust clamp). */
export const RETRIEVAL_MAX_TOKENS_MIN = 256
export const RETRIEVAL_MAX_TOKENS_MAX = 32_768
export const RETRIEVAL_MAX_TOKENS_DEFAULT = 4096

export type AiSettingsDto = {
  provider: AiProviderId
  apiKey: string
  modelId: string
  baseUrl: string | null
  /** Token budget for prior chat messages only (short-term memory window). */
  contextMaxHistoryTokens: number
  /** Empty string = use provider default embedding model in the app. */
  embeddingModelId: string
  /** 1 = inject retrieved RAG context each turn; 0 = off. */
  retrievalAutoInject: number
  retrievalMaxTokens: number
  embeddingFallbackBaseUrl: string | null
  embeddingFallbackApiKey: string | null
  embeddingFallbackModel: string | null
}

const defaultDto = (): AiSettingsDto => ({
  provider: 'openai',
  apiKey: '',
  modelId: defaultModelForProvider('openai'),
  baseUrl: null,
  contextMaxHistoryTokens: CONTEXT_MAX_HISTORY_TOKENS_DEFAULT,
  embeddingModelId: '',
  retrievalAutoInject: 1,
  retrievalMaxTokens: RETRIEVAL_MAX_TOKENS_DEFAULT,
  embeddingFallbackBaseUrl: null,
  embeddingFallbackApiKey: null,
  embeddingFallbackModel: null,
})

function clampRetrievalTokens(n: number): number {
  return Math.min(
    RETRIEVAL_MAX_TOKENS_MAX,
    Math.max(RETRIEVAL_MAX_TOKENS_MIN, Math.round(n)),
  )
}

function readLocal(): AiSettingsDto {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return defaultDto()
    const p = JSON.parse(raw) as Partial<AiSettingsDto>
    const rawCtx = (p as { contextMaxHistoryTokens?: unknown }).contextMaxHistoryTokens
    let contextMaxHistoryTokens = CONTEXT_MAX_HISTORY_TOKENS_DEFAULT
    if (typeof rawCtx === 'number' && Number.isFinite(rawCtx)) {
      contextMaxHistoryTokens = clampContextTokens(rawCtx)
    }
    const rawRt = (p as { retrievalMaxTokens?: unknown }).retrievalMaxTokens
    let retrievalMaxTokens = RETRIEVAL_MAX_TOKENS_DEFAULT
    if (typeof rawRt === 'number' && Number.isFinite(rawRt)) {
      retrievalMaxTokens = clampRetrievalTokens(rawRt)
    }
    return {
      provider: (p.provider as AiProviderId) ?? 'openai',
      apiKey: typeof p.apiKey === 'string' ? p.apiKey : '',
      modelId: typeof p.modelId === 'string' ? p.modelId : defaultModelForProvider('openai'),
      baseUrl:
        typeof p.baseUrl === 'string' && p.baseUrl.trim()
          ? p.baseUrl.trim()
          : null,
      contextMaxHistoryTokens,
      embeddingModelId:
        typeof p.embeddingModelId === 'string' ? p.embeddingModelId : '',
      retrievalAutoInject:
        typeof p.retrievalAutoInject === 'number' && p.retrievalAutoInject === 0
          ? 0
          : 1,
      retrievalMaxTokens,
      embeddingFallbackBaseUrl:
        typeof p.embeddingFallbackBaseUrl === 'string' && p.embeddingFallbackBaseUrl.trim()
          ? p.embeddingFallbackBaseUrl.trim()
          : null,
      embeddingFallbackApiKey:
        typeof p.embeddingFallbackApiKey === 'string' && p.embeddingFallbackApiKey.trim()
          ? p.embeddingFallbackApiKey.trim()
          : null,
      embeddingFallbackModel:
        typeof p.embeddingFallbackModel === 'string' && p.embeddingFallbackModel.trim()
          ? p.embeddingFallbackModel.trim()
          : null,
    }
  } catch {
    return defaultDto()
  }
}

function clampContextTokens(n: number): number {
  return Math.min(
    CONTEXT_MAX_HISTORY_TOKENS_MAX,
    Math.max(CONTEXT_MAX_HISTORY_TOKENS_MIN, Math.round(n)),
  )
}

function writeLocal(s: AiSettingsDto) {
  localStorage.setItem(
    LS_KEY,
    JSON.stringify({
      ...s,
      contextMaxHistoryTokens: clampContextTokens(s.contextMaxHistoryTokens),
      retrievalMaxTokens: clampRetrievalTokens(s.retrievalMaxTokens),
    }),
  )
}

/** Normalize Tauri IPC (camelCase) and any snake_case fallback. */
function normalizeFromInvoke(raw: unknown): AiSettingsDto {
  if (!raw || typeof raw !== 'object') return defaultDto()
  const r = raw as Record<string, unknown>
  const apiKey = r.apiKey ?? r.api_key
  const modelId = r.modelId ?? r.model_id
  const baseUrl = r.baseUrl ?? r.base_url
  const ctxRaw = r.contextMaxHistoryTokens ?? r.context_max_history_tokens
  let contextMaxHistoryTokens = CONTEXT_MAX_HISTORY_TOKENS_DEFAULT
  if (typeof ctxRaw === 'number' && Number.isFinite(ctxRaw)) {
    contextMaxHistoryTokens = clampContextTokens(ctxRaw)
  }
  const embModel = r.embeddingModelId ?? r.embedding_model_id
  const rAuto = r.retrievalAutoInject ?? r.retrieval_auto_inject
  const rMax = r.retrievalMaxTokens ?? r.retrieval_max_tokens
  let retrievalMaxTokens = RETRIEVAL_MAX_TOKENS_DEFAULT
  if (typeof rMax === 'number' && Number.isFinite(rMax)) {
    retrievalMaxTokens = clampRetrievalTokens(rMax)
  }
  const fbUrl = r.embeddingFallbackBaseUrl ?? r.embedding_fallback_base_url
  const fbKey = r.embeddingFallbackApiKey ?? r.embedding_fallback_api_key
  const fbModel = r.embeddingFallbackModel ?? r.embedding_fallback_model

  return {
    provider: (typeof r.provider === 'string' ? r.provider : 'openai') as AiProviderId,
    apiKey: typeof apiKey === 'string' ? apiKey : '',
    modelId:
      typeof modelId === 'string' && modelId
        ? modelId
        : defaultModelForProvider('openai'),
    baseUrl:
      typeof baseUrl === 'string' && baseUrl.trim() ? baseUrl.trim() : null,
    contextMaxHistoryTokens,
    embeddingModelId: typeof embModel === 'string' ? embModel : '',
    retrievalAutoInject:
      typeof rAuto === 'number' && rAuto === 0 ? 0 : 1,
    retrievalMaxTokens,
    embeddingFallbackBaseUrl:
      typeof fbUrl === 'string' && fbUrl.trim() ? fbUrl.trim() : null,
    embeddingFallbackApiKey:
      typeof fbKey === 'string' && fbKey.trim() ? fbKey.trim() : null,
    embeddingFallbackModel:
      typeof fbModel === 'string' && fbModel.trim() ? fbModel.trim() : null,
  }
}

export async function aiSettingsGet(): Promise<AiSettingsDto> {
  if (!isTauri()) return readLocal()
  const raw = await invoke<unknown>('ai_settings_get')
  return normalizeFromInvoke(raw)
}

export async function aiSettingsSet(settings: AiSettingsDto): Promise<void> {
  const normalized: AiSettingsDto = {
    ...settings,
    contextMaxHistoryTokens: clampContextTokens(settings.contextMaxHistoryTokens),
    retrievalMaxTokens: clampRetrievalTokens(settings.retrievalMaxTokens),
    retrievalAutoInject: settings.retrievalAutoInject === 0 ? 0 : 1,
  }
  if (!isTauri()) {
    writeLocal(normalized)
    return
  }
  await invoke('ai_settings_set', { settings: normalized })
}
