const LS_KEY = 'braian.io.memorySettings.v1'

export type MemorySettings = {
  /** When true, schedule debounced memory review after chat turns. */
  autoReviewOnIdle: boolean
}

const defaultSettings = (): MemorySettings => ({
  autoReviewOnIdle: false,
})

export function memorySettingsGet(): MemorySettings {
  if (typeof localStorage === 'undefined') return defaultSettings()
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return defaultSettings()
    const p = JSON.parse(raw) as Partial<MemorySettings>
    return {
      autoReviewOnIdle: p.autoReviewOnIdle === true,
    }
  } catch {
    return defaultSettings()
  }
}

export function memorySettingsSet(patch: Partial<MemorySettings>): void {
  if (typeof localStorage === 'undefined') return
  const next = { ...memorySettingsGet(), ...patch }
  localStorage.setItem(LS_KEY, JSON.stringify(next))
}
