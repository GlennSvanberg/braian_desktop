import aiModelsCatalog from './ai-models-catalog.json'

/** Values stored in SQLite / settings (must match Rust validation). */
export type AiProviderId =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'openai_compatible'

export type ModelOption = { id: string; label: string }

type CatalogProvider = {
  id: string
  label: string
  models: ModelOption[]
}

function parseCatalog(raw: unknown): CatalogProvider[] {
  if (!raw || typeof raw !== 'object') {
    throw new Error('ai-models-catalog.json: expected object root')
  }
  const o = raw as Record<string, unknown>
  const providers = o.providers
  if (!Array.isArray(providers)) {
    throw new Error('ai-models-catalog.json: missing providers array')
  }
  return providers.map((p, i) => {
    if (!p || typeof p !== 'object') {
      throw new Error(`ai-models-catalog.json: providers[${i}] invalid`)
    }
    const row = p as Record<string, unknown>
    const id = row.id
    const label = row.label
    const models = row.models
    if (typeof id !== 'string' || !id) {
      throw new Error(`ai-models-catalog.json: providers[${i}].id invalid`)
    }
    if (typeof label !== 'string' || !label) {
      throw new Error(`ai-models-catalog.json: providers[${i}].label invalid`)
    }
    if (!Array.isArray(models)) {
      throw new Error(`ai-models-catalog.json: providers[${i}].models must be array`)
    }
    const options: ModelOption[] = models.map((m, j) => {
      if (!m || typeof m !== 'object') {
        throw new Error(`ai-models-catalog.json: model [${i}][${j}] invalid`)
      }
      const mo = m as Record<string, unknown>
      const mid = mo.id
      const mlabel = mo.label
      if (typeof mid !== 'string' || !mid) {
        throw new Error(`ai-models-catalog.json: model [${i}][${j}].id invalid`)
      }
      if (typeof mlabel !== 'string' || !mlabel) {
        throw new Error(`ai-models-catalog.json: model [${i}][${j}].label invalid`)
      }
      return { id: mid, label: mlabel }
    })
    return { id, label, models: options }
  })
}

const PROVIDER_ORDER = [
  'openai',
  'anthropic',
  'gemini',
  'openai_compatible',
] as const satisfies readonly AiProviderId[]

const parsedProviders = parseCatalog(aiModelsCatalog)
const byId = new Map(parsedProviders.map((p) => [p.id, p]))

export const AI_PROVIDERS: Array<{
  id: AiProviderId
  label: string
  models: ModelOption[]
}> = PROVIDER_ORDER.map((id) => {
  const row = byId.get(id)
  if (!row) {
    throw new Error(`ai-models-catalog.json: missing provider "${id}"`)
  }
  return { id, label: row.label, models: row.models }
})

export function providerMeta(id: string) {
  return AI_PROVIDERS.find((p) => p.id === id)
}

/** Options for the settings model dropdown, including a saved id missing from the static list. */
export function modelOptionsForUi(
  provider: AiProviderId,
  currentModelId: string,
): ModelOption[] {
  const base = providerMeta(provider)?.models ?? []
  const id = currentModelId.trim()
  if (!id || base.some((m) => m.id === id)) return base
  return [{ id, label: `${id} (saved)` }, ...base]
}

export function defaultModelForProvider(id: AiProviderId): string {
  if (id === 'openai_compatible') return ''
  const p = providerMeta(id)
  return p?.models[0]?.id ?? 'gpt-5.4'
}
