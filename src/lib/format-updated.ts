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
