/**
 * Compact relative time since last update (minutes `m`, hours `h`, days `d`, months `mo`).
 * Use for chat row hints; distinct from {@link formatUpdatedLabel} tooltips.
 */
export function formatShortTimeSince(
  updatedAtMs: number,
  nowMs: number = Date.now(),
): string {
  if (updatedAtMs <= 0) return '—'
  const sec = Math.floor((nowMs - updatedAtMs) / 1000)
  if (sec < 60) return 'now'
  if (sec < 3600) return `${Math.floor(sec / 60)}m`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`
  if (sec < 86400 * 30) return `${Math.floor(sec / 86400)}d`
  if (sec < 86400 * 365) return `${Math.max(1, Math.floor(sec / (86400 * 30)))}mo`
  return `${Math.max(1, Math.floor(sec / (86400 * 365)))}y`
}

/** Short relative label for sidebar “last updated” hints. */
export function formatUpdatedLabel(updatedAtMs: number): string {
  if (updatedAtMs <= 0) return '—'
  const sec = Math.floor((Date.now() - updatedAtMs) / 1000)
  if (sec < 45) return 'Just now'
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  if (sec < 604800) return `${Math.floor(sec / 86400)}d ago`
  return new Date(updatedAtMs).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}
