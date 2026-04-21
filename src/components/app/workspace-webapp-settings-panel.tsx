import { useCallback, useEffect, useState } from 'react'

import { ArrowWorkspaceSandbox } from '@/components/app/arrow-workspace-sandbox'
import { loadArrowAppsIndex } from '@/lib/workspace-arrow-apps/io'
import { useWorkspaceArrowCloudBundle } from '@/lib/workspace-arrow-apps/use-workspace-arrow-cloud-bundle'
import { isTauri } from '@/lib/tauri-env'
import { cn } from '@/lib/utils'

type Props = {
  workspaceId: string
  isTauriRuntime: boolean
  className?: string
}

export function WorkspaceWebappSettingsPanel({
  workspaceId,
  isTauriRuntime,
  className,
}: Props) {
  const [reloadNonce, setReloadNonce] = useState(0)
  const [appId, setAppId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

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
        setMessage('Sign in to preview Arrow apps synced to the cloud.')
        return
      }
      if (cloudBundle === undefined) {
        setAppId(null)
        setMessage('Loading Arrow apps…')
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
      setMessage(
        pick
          ? 'Editing with Arrow sandbox. Apps are stored in your cloud workspace (Convex).'
          : 'Create apps from a chat in App mode (see bundled app-builder skill).',
      )
      return
    }

    if (!isTauriRuntime) {
      setAppId(null)
      setMessage('Arrow apps are available in the desktop app with a workspace folder.')
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
        setMessage(
          pick
            ? `Editing with Arrow sandbox. Apps live under .braian/arrow-apps/ and the index is .braian/arrow-apps.json.`
            : 'Create apps from a workspace chat in App mode (see bundled app-builder skill).',
        )
      } catch (e) {
        if (!cancelled) {
          setAppId(null)
          setMessage(e instanceof Error ? e.message : String(e))
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

  const showPreview = (isTauriRuntime && appId) || (isCloudWeb && appId)

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col gap-3', className)}>
      <p className="text-text-3 text-sm">{message}</p>
      {!showPreview ? null : (
        <>
          <div className="flex justify-end">
            <button
              type="button"
              className="text-text-3 hover:text-text-2 text-xs"
              onClick={() => reload()}
            >
              Reload preview
            </button>
          </div>
          <ArrowWorkspaceSandbox
            workspaceId={workspaceId}
            appId={appId!}
            reloadNonce={reloadNonce}
            inlineSources={!isTauri() && isCloudWeb ? inlineSourcesForApp(appId) : null}
            className="min-h-[320px] min-w-0 flex-1"
          />
        </>
      )}
    </div>
  )
}
