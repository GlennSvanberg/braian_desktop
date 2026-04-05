/**
 * Theme preference stored in localStorage as `theme`: `light` | `dark` | `auto`.
 * Keep validation and DOM updates in sync with `THEME_INIT_SCRIPT` in
 * `src/routes/__root.tsx` (inline script runs before paint). If you change this
 * file, update that script to match.
 */

export const THEME_STORAGE_KEY = 'theme'

export type ThemePreference = 'light' | 'dark' | 'auto'

export function readThemePreference(): ThemePreference {
  if (typeof window === 'undefined') return 'auto'
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'auto') {
      return stored
    }
  } catch {
    /* ignore */
  }
  return 'auto'
}

export function resolveAppearance(mode: ThemePreference): 'light' | 'dark' {
  if (mode === 'auto') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light'
  }
  return mode
}

/** Applies class on `<html>`, `data-theme`, and `colorScheme` to match `THEME_INIT_SCRIPT`. */
export function applyThemePreference(mode: ThemePreference): void {
  if (typeof document === 'undefined') return
  const resolved = resolveAppearance(mode)
  const root = document.documentElement
  root.classList.remove('light', 'dark')
  root.classList.add(resolved)
  if (mode === 'auto') {
    root.removeAttribute('data-theme')
  } else {
    root.setAttribute('data-theme', mode)
  }
  root.style.colorScheme = resolved
}

export function persistThemePreference(mode: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode)
  } catch {
    /* ignore */
  }
  applyThemePreference(mode)
}
