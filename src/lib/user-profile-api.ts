const LS_KEY = 'braian.io.userProfile.v1'

export type UserProfileDto = {
  displayName?: string
  location?: string
  /** ISO-ish language tags or plain names, e.g. "en", "Norwegian". */
  preferredLanguages?: string[]
  timezoneNote?: string
  notes?: string
}

const listeners = new Set<() => void>()

export function userProfileSubscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function emitProfileChange() {
  for (const l of listeners) l()
}

function defaultProfile(): UserProfileDto {
  return {}
}

function normalize(raw: unknown): UserProfileDto {
  if (!raw || typeof raw !== 'object') return defaultProfile()
  const r = raw as Record<string, unknown>
  const displayName =
    typeof r.displayName === 'string' ? r.displayName : undefined
  const location = typeof r.location === 'string' ? r.location : undefined
  const timezoneNote =
    typeof r.timezoneNote === 'string' ? r.timezoneNote : undefined
  const notes = typeof r.notes === 'string' ? r.notes : undefined
  let preferredLanguages: string[] | undefined
  if (Array.isArray(r.preferredLanguages)) {
    preferredLanguages = r.preferredLanguages.filter(
      (x): x is string => typeof x === 'string',
    )
  }
  const out: UserProfileDto = {}
  if (displayName !== undefined) out.displayName = displayName
  if (location !== undefined) out.location = location
  if (timezoneNote !== undefined) out.timezoneNote = timezoneNote
  if (notes !== undefined) out.notes = notes
  if (preferredLanguages !== undefined && preferredLanguages.length > 0) {
    out.preferredLanguages = preferredLanguages
  }
  return out
}

function readLocal(): UserProfileDto {
  if (typeof localStorage === 'undefined') return defaultProfile()
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return defaultProfile()
    return normalize(JSON.parse(raw))
  } catch {
    return defaultProfile()
  }
}

function writeLocal(p: UserProfileDto) {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(LS_KEY, JSON.stringify(p))
}

/** Synchronous read of persisted user profile (localStorage). */
export function userProfileGet(): UserProfileDto {
  return readLocal()
}

/**
 * Merge patch: only keys present on `patch` are applied.
 * Pass `null` for a string field to clear it. Arrays replace when provided.
 */
export function userProfileApplyPatch(
  patch: Partial<UserProfileDto> & {
    displayName?: string | null
    location?: string | null
    timezoneNote?: string | null
    notes?: string | null
  },
): UserProfileDto {
  const prev = readLocal()
  const next: UserProfileDto = { ...prev }

  if ('displayName' in patch) {
    const v = patch.displayName
    if (v === null || v === '') delete next.displayName
    else if (typeof v === 'string') next.displayName = v
  }
  if ('location' in patch) {
    const v = patch.location
    if (v === null || v === '') delete next.location
    else if (typeof v === 'string') next.location = v
  }
  if ('timezoneNote' in patch) {
    const v = patch.timezoneNote
    if (v === null || v === '') delete next.timezoneNote
    else if (typeof v === 'string') next.timezoneNote = v
  }
  if ('notes' in patch) {
    const v = patch.notes
    if (v === null || v === '') delete next.notes
    else if (typeof v === 'string') next.notes = v
  }
  if ('preferredLanguages' in patch && patch.preferredLanguages !== undefined) {
    if (patch.preferredLanguages.length === 0) {
      delete next.preferredLanguages
    } else {
      next.preferredLanguages = [...patch.preferredLanguages]
    }
  }

  const prevJson = JSON.stringify(prev)
  const nextJson = JSON.stringify(next)
  if (prevJson === nextJson) return prev

  writeLocal(next)
  emitProfileChange()
  return next
}

function isEmptyProfile(p: UserProfileDto): boolean {
  return (
    (p.displayName == null || p.displayName.trim() === '') &&
    (p.location == null || p.location.trim() === '') &&
    (p.timezoneNote == null || p.timezoneNote.trim() === '') &&
    (p.notes == null || p.notes.trim() === '') &&
    (p.preferredLanguages == null || p.preferredLanguages.length === 0)
  )
}

/** Compact text for system prompts (global agents and profile coach). */
export function formatUserProfileForPrompt(p: UserProfileDto): string {
  if (isEmptyProfile(p)) {
    return 'No user profile has been saved yet. The user can fill this in via the Profile chat (sidebar → You).'
  }
  const lines: string[] = []
  if (p.displayName?.trim()) lines.push(`Name: ${p.displayName.trim()}`)
  if (p.location?.trim()) lines.push(`Location: ${p.location.trim()}`)
  if (p.preferredLanguages?.length) {
    lines.push(`Preferred languages: ${p.preferredLanguages.join(', ')}`)
  }
  if (p.timezoneNote?.trim()) {
    lines.push(`Timezone / locale note: ${p.timezoneNote.trim()}`)
  }
  if (p.notes?.trim()) {
    lines.push(`Notes:\n${p.notes.trim()}`)
  }
  return lines.join('\n')
}
