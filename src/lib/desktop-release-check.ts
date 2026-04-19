import { invoke } from '@tauri-apps/api/core'
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  type GithubLatestReleaseDto,
  getDesktopReleasesOwnerRepo,
} from '@/lib/desktop-releases'

const DISMISS_KEY = 'braian.dismissedReleaseTag'
const MIN_CHECK_INTERVAL_MS = 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

export function stripReleaseVersion(tag: string): string {
  return tag.replace(/^v/i, '').trim()
}

/** Parse `major.minor.patch` numeric prefix; ignores pre-release suffix for ordering. */
function semverParts(s: string): [number, number, number] {
  const core = stripReleaseVersion(s).split('-')[0]?.split('+')[0] ?? '0'
  const parts = core.split('.').map((x) => {
    const n = Number.parseInt(x, 10)
    return Number.isFinite(n) ? n : 0
  })
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0]
}

/** -1 if a < b, 0 if equal, 1 if a > b */
export function compareSemver(a: string, b: string): number {
  const [a1, a2, a3] = semverParts(a)
  const [b1, b2, b3] = semverParts(b)
  if (a1 !== b1) return a1 < b1 ? -1 : 1
  if (a2 !== b2) return a2 < b2 ? -1 : 1
  if (a3 !== b3) return a3 < b3 ? -1 : 1
  return 0
}

export type DesktopUpdatePhase =
  | 'idle'
  | 'checking'
  | 'upToDate'
  | 'updateAvailable'
  | 'error'

export function useDesktopReleaseCheck(enabled: boolean) {
  const [phase, setPhase] = useState<DesktopUpdatePhase>('idle')
  const [currentVersion, setCurrentVersion] = useState<string>('')
  const [latest, setLatest] = useState<GithubLatestReleaseDto | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const lastRunRef = useRef(0)

  const runCheck = useCallback(async () => {
    if (!enabled) return
    const now = Date.now()
    if (now - lastRunRef.current < MIN_CHECK_INTERVAL_MS && lastRunRef.current > 0) {
      return
    }
    lastRunRef.current = now

    setPhase((p) => (p === 'idle' ? 'checking' : p))
    try {
      const { getVersion } = await import('@tauri-apps/api/app')
      const v = await getVersion()
      setCurrentVersion(v)

      const { owner, repo } = getDesktopReleasesOwnerRepo()
      const info = await invoke<GithubLatestReleaseDto>('check_github_release', {
        owner,
        repo,
      })

      setLatest(info)
      const remote = stripReleaseVersion(info.tagName)
      const cmp = compareSemver(remote, v)
      const dismissed = window.localStorage.getItem(DISMISS_KEY)

      if (cmp > 0 && info.tagName !== dismissed) {
        setPhase('updateAvailable')
        setDialogOpen(true)
      } else {
        setPhase('upToDate')
      }
    } catch {
      setPhase('error')
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled) return
    void runCheck()
    const id = window.setInterval(() => void runCheck(), DAY_MS)
    return () => window.clearInterval(id)
  }, [enabled, runCheck])

  useEffect(() => {
    if (!enabled) return
    const onFocus = () => void runCheck()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [enabled, runCheck])

  const dismiss = useCallback(() => {
    if (latest) {
      try {
        window.localStorage.setItem(DISMISS_KEY, latest.tagName)
      } catch {
        /* ignore */
      }
    }
    setDialogOpen(false)
  }, [latest])

  const downloadTargetUrl =
    latest?.preferredDownloadUrl?.trim() || latest?.htmlUrl || ''

  return {
    phase,
    currentVersion,
    latest,
    dialogOpen,
    setDialogOpen,
    downloadTargetUrl,
    dismiss,
    recheck: runCheck,
  }
}
