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

export type AiSettingsDto = {
  provider: AiProviderId
  apiKey: string
  modelId: string
  baseUrl: string | null
  /** Token budget for prior chat messages only (short-term memory window). */
  contextMaxHistoryTokens: number
}

const defaultDto = (): AiSettingsDto => ({
  provider: 'openai',
  apiKey: '',
  modelId: defaultModelForProvider('openai'),
  baseUrl: null,
  contextMaxHistoryTokens: CONTEXT_MAX_HISTORY_TOKENS_DEFAULT,
})

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
    return {
      provider: (p.provider as AiProviderId) ?? 'openai',
      apiKey: typeof p.apiKey === 'string' ? p.apiKey : '',
      modelId: typeof p.modelId === 'string' ? p.modelId : defaultModelForProvider('openai'),
      baseUrl:
        typeof p.baseUrl === 'string' && p.baseUrl.trim()
          ? p.baseUrl.trim()
          : null,
      contextMaxHistoryTokens,
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
    JSON.stringify({ ...s, contextMaxHistoryTokens: clampContextTokens(s.contextMaxHistoryTokens) }),
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
  }
  if (!isTauri()) {
    writeLocal(normalized)
    return
  }
  await invoke('ai_settings_set', { settings: normalized })
}
