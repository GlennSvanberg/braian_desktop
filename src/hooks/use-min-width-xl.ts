import { useSyncExternalStore } from 'react'

/** Matches Tailwind `xl` (1280px). */
const XL_MIN_PX = 1280
const QUERY = `(min-width: ${XL_MIN_PX}px)`

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(QUERY)
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}

function getSnapshot() {
  return window.matchMedia(QUERY).matches
}

function getServerSnapshot() {
  return false
}

/** True when viewport is at least Tailwind `xl` — use for responsive layout switches. */
export function useMinWidthXl() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
