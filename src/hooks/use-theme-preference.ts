import { useCallback, useEffect, useLayoutEffect, useState } from 'react'

import {
  type ThemePreference,
  applyThemePreference,
  persistThemePreference,
  readThemePreference,
} from '@/lib/theme-preference'

export function useThemePreference() {
  const [preference, setPreferenceState] = useState<ThemePreference>('auto')
  const [ready, setReady] = useState(false)

  useLayoutEffect(() => {
    setPreferenceState(readThemePreference())
    setReady(true)
  }, [])

  const setPreference = useCallback((mode: ThemePreference) => {
    persistThemePreference(mode)
    setPreferenceState(mode)
  }, [])

  useEffect(() => {
    if (!ready || preference !== 'auto') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      applyThemePreference('auto')
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [ready, preference])

  useEffect(() => {
    if (!ready) return
    const onStorage = (e: StorageEvent) => {
      if (e.key !== 'theme') return
      if (e.newValue == null) {
        applyThemePreference('auto')
        setPreferenceState('auto')
        return
      }
      if (e.newValue === 'light' || e.newValue === 'dark' || e.newValue === 'auto') {
        applyThemePreference(e.newValue)
        setPreferenceState(e.newValue)
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [ready])

  return { preference, setPreference, ready }
}
