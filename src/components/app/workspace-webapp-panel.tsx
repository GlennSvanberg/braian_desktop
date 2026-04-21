import { useCallback, useEffect, useState } from 'react'

import { ArrowWorkspaceSandbox } from '@/components/app/arrow-workspace-sandbox'
import { loadArrowAppsIndex } from '@/lib/workspace-arrow-apps/io'
import { useWorkspaceArrowCloudBundle } from '@/lib/workspace-arrow-apps/use-workspace-arrow-cloud-bundle'
import { cn } from '@/lib/utils'

type Props = {
  workspaceId: string
  isTauriRuntime: boolean
  className?: string
}

export function WorkspaceWebappPanel({
  workspaceId,
  isTauriRuntime,
  className,
}: Props) {
  const [reloadNonce, setReloadNonce] = useState(0)
  const [appId, setAppId] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)

  const reload = useCallback(() => {
    setReloadNonce((n) => n + 1)
  }, [])

  const {
    isCloudWeb,
    bundle: cloudBundle,
    authLoading,
    isAuthenticated,
    inlineSourcesForApp,
  } = useWorkspaceArrowCloudBundle(workspaceId)

  useEffect(() => {
    if (isCloudWeb) {
      if (!isAuthenticated || authLoading) {
        setAppId(null)
        setHint('Sign in to load Arrow apps synced to the cloud.')
        return
      }
      if (cloudBundle === undefined) {
        setAppId(null)
        setHint('Loading Arrow apps…')
        return
      }
      const index = {
        schemaVersion: 1 as const,
        generatedAtMs: Date.now(),
        activeAppId: cloudBundle.meta.activeAppId,
        apps: cloudBundle.apps.map((a) => ({
          id: a.appId,
          title: a.title,
          updatedAtMs: a.updatedAtMs,
        })),
      }
      const pick =
        index.activeAppId && index.apps.some((a) => a.id === index.activeAppId)
          ? index.activeAppId
          : index.apps[0]?.id ?? null
      setAppId(pick)
      setHint(
        pick
          ? null
          : 'No Arrow apps in your cloud workspace yet. Use App mode in chat (desktop or web) to add one.',
      )
      return
    }

    if (!isTauriRuntime) {
      setAppId(null)
      setHint('Open Braian Desktop to run workspace Arrow apps from a local folder.')
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const index = await loadArrowAppsIndex(workspaceId)
        if (cancelled) return
        const pick =
          index.activeAppId && index.apps.some((a) => a.id === index.activeAppId)
            ? index.activeAppId
            : index.apps[0]?.id ?? null
        setAppId(pick)
        setHint(
          pick
            ? null
            : 'No Arrow apps yet. In a workspace chat, use App mode and ask the assistant to add one.',
        )
      } catch (e) {
        if (!cancelled) {
          setAppId(null)
          setHint(e instanceof Error ? e.message : String(e))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [
    workspaceId,
    isTauriRuntime,
    reloadNonce,
    isCloudWeb,
    isAuthenticated,
    authLoading,
    cloudBundle,
  ])

  if (!isTauriRuntime && !isCloudWeb) {
    return (
      <div
        className={cn(
          'text-text-3 flex min-h-[200px] items-center justify-center p-6 text-sm',
          className,
        )}
      >
        {hint}
      </div>
    )
  }

  if (!appId) {
    return (
      <div
        className={cn(
          'text-text-3 flex min-h-[200px] flex-col items-center justify-center gap-3 p-6 text-center text-sm',
          className,
        )}
      >
        <p>{hint}</p>
        <button
          type="button"
          className="text-accent-600 hover:underline"
          onClick={() => reload()}
        >
          Refresh
        </button>
      </div>
    )
  }

  return (
    <div className={cn('flex min-h-0 min-w-0 flex-1 flex-col', className)}>
      <div className="border-border flex shrink-0 items-center justify-end gap-2 border-b px-2 py-1">
        <button
          type="button"
          className="text-text-3 hover:text-text-2 text-xs"
          onClick={() => reload()}
        >
          Reload
        </button>
      </div>
      <ArrowWorkspaceSandbox
        workspaceId={workspaceId}
        appId={appId}
        reloadNonce={reloadNonce}
        inlineSources={isCloudWeb ? inlineSourcesForApp(appId) : null}
        className="min-h-0 flex-1 rounded-none border-0"
      />
    </div>
  )
}
