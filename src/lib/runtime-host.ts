import { useLayoutEffect, useState } from 'react'

import { isTauri } from '@/lib/tauri-env'

export type RuntimeHost = 'pending' | 'tauri' | 'browser'

/** Resolves after layout so `isTauri()` is reliable without SSR/CSR mismatch on `/`. */
export function useRuntimeHost(): RuntimeHost {
  const [host, setHost] = useState<RuntimeHost>('pending')
  useLayoutEffect(() => {
    setHost(isTauri() ? 'tauri' : 'browser')
  }, [])
  return host
}
