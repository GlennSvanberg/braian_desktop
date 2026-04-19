import type { CloudThreadSnapshot } from './diff'

/**
 * Per-conversation cloud-snapshot persistence.
 *
 * The snapshot is the cheap "what we believe the cloud already has"
 * dictionary used by `diffForPush` to decide which messages still need to
 * be uploaded. It deliberately lives in `localStorage` (per-device, per
 * convex deployment) rather than in `.braian/` because it's a sync
 * implementation detail - not something the user should ever see in their
 * workspace folder.
 */

const KEY_PREFIX = 'braian.cloud.snapshot:'

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined'
}

function key(clientId: string): string {
  return `${KEY_PREFIX}${clientId}`
}

export function readSnapshot(clientId: string): CloudThreadSnapshot | null {
  if (!isBrowser()) return null
  try {
    const raw = localStorage.getItem(key(clientId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as CloudThreadSnapshot
    if (!parsed.conversation || !Array.isArray(parsed.messageIds)) return null
    return parsed
  } catch {
    return null
  }
}

export function writeSnapshot(snapshot: CloudThreadSnapshot): void {
  if (!isBrowser()) return
  try {
    localStorage.setItem(key(snapshot.conversation.clientId), JSON.stringify(snapshot))
  } catch {
    // ignore quota / serialization errors - snapshot is best-effort
  }
}

export function clearSnapshot(clientId: string): void {
  if (!isBrowser()) return
  try {
    localStorage.removeItem(key(clientId))
  } catch {
    // ignore
  }
}
