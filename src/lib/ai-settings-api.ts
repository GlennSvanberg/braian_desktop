import { invoke } from '@tauri-apps/api/core'

import {
  type AiProviderId,
  defaultModelForProvider,
} from '@/lib/ai/model-catalog'
import { isTauri } from '@/lib/tauri-env'

const LS_KEY = 'braian.io.aiSettings.v1'

export type AiSettingsDto = {
  provider: AiProviderId
  apiKey: string
  modelId: string
  baseUrl: string | null
}

const defaultDto = (): AiSettingsDto => ({
  provider: 'openai',
  apiKey: '',
  modelId: defaultModelForProvider('openai'),
  baseUrl: null,
})

function readLocal(): AiSettingsDto {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return defaultDto()
    const p = JSON.parse(raw) as Partial<AiSettingsDto>
    return {
      provider: (p.provider as AiProviderId) ?? 'openai',
      apiKey: typeof p.apiKey === 'string' ? p.apiKey : '',
      modelId: typeof p.modelId === 'string' ? p.modelId : defaultModelForProvider('openai'),
      baseUrl:
        typeof p.baseUrl === 'string' && p.baseUrl.trim()
          ? p.baseUrl.trim()
          : null,
    }
  } catch {
    return defaultDto()
  }
}

function writeLocal(s: AiSettingsDto) {
  localStorage.setItem(LS_KEY, JSON.stringify(s))
}

/** Normalize Tauri IPC (camelCase) and any snake_case fallback. */
function normalizeFromInvoke(raw: unknown): AiSettingsDto {
  if (!raw || typeof raw !== 'object') return defaultDto()
  const r = raw as Record<string, unknown>
  const apiKey = r.apiKey ?? r.api_key
  const modelId = r.modelId ?? r.model_id
  const baseUrl = r.baseUrl ?? r.base_url
  return {
    provider: (typeof r.provider === 'string' ? r.provider : 'openai') as AiProviderId,
    apiKey: typeof apiKey === 'string' ? apiKey : '',
    modelId:
      typeof modelId === 'string' && modelId
        ? modelId
        : defaultModelForProvider('openai'),
    baseUrl:
      typeof baseUrl === 'string' && baseUrl.trim() ? baseUrl.trim() : null,
  }
}

export async function aiSettingsGet(): Promise<AiSettingsDto> {
  if (!isTauri()) return readLocal()
  const raw = await invoke<unknown>('ai_settings_get')
  return normalizeFromInvoke(raw)
}

export async function aiSettingsSet(settings: AiSettingsDto): Promise<void> {
  if (!isTauri()) {
    writeLocal(settings)
    return
  }
  await invoke('ai_settings_set', { settings })
}
