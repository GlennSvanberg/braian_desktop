/** Values stored in SQLite / settings (must match Rust validation). */
export type AiProviderId =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'openai_compatible'

export type ModelOption = { id: string; label: string }

export const AI_PROVIDERS: Array<{
  id: AiProviderId
  label: string
  models: ModelOption[]
}> = [
  {
    id: 'openai',
    label: 'OpenAI',
    models: [
      { id: 'gpt-4o', label: 'GPT-4o' },
      { id: 'gpt-4o-mini', label: 'GPT-4o mini' },
      { id: 'gpt-5.2', label: 'GPT-5.2' },
      { id: 'gpt-5.1', label: 'GPT-5.1' },
      { id: 'o4-mini', label: 'o4-mini' },
    ],
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    models: [
      { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
      { id: 'claude-opus-4-5', label: 'Claude Opus 4.5' },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
      { id: 'claude-3-5-haiku-latest', label: 'Claude 3.5 Haiku' },
    ],
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    models: [
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
      { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash (preview)' },
      { id: 'gemini-3-pro-preview', label: 'Gemini 3 Pro (preview)' },
    ],
  },
  {
    id: 'openai_compatible',
    label: 'OpenAI-compatible (e.g. xAI, OpenRouter)',
    models: [],
  },
]

export function providerMeta(id: string) {
  return AI_PROVIDERS.find((p) => p.id === id)
}

export function defaultModelForProvider(id: AiProviderId): string {
  if (id === 'openai_compatible') return ''
  const p = providerMeta(id)
  return p?.models[0]?.id ?? 'gpt-4o'
}
