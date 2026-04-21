import { useEffect, useRef, useState } from 'react'

import { arrowAppMainCssRelative, arrowAppMainTsRelative } from '@/lib/workspace-arrow-apps/constants'
import { workspaceReadTextFile } from '@/lib/workspace-api'
import { cn } from '@/lib/utils'

export type ArrowWorkspaceSandboxProps = {
  workspaceId: string
  appId: string
  className?: string
  /** Bump to reload sources from disk after tool writes. */
  reloadNonce?: number
  /**
   * When set (e.g. cloud web build), skip `workspaceReadTextFile` and compile
   * these virtual files instead. Keys are `main.ts` / `main.css`.
   */
  inlineSources?: Record<string, string> | null
  shadowDOM?: boolean
  onOutput?: (payload: unknown) => void
  onRuntimeError?: (message: string) => void
}

/**
 * Mounts an `@arrow-js/sandbox` view from `.braian/arrow-apps/<appId>/main.ts`
 * (+ optional `main.css`). Host owns persistence; sandbox uses `output(payload)` to emit JSON.
 */
export function ArrowWorkspaceSandbox({
  workspaceId,
  appId,
  className,
  reloadNonce = 0,
  inlineSources = null,
  shadowDOM = true,
  onOutput,
  onRuntimeError,
}: ArrowWorkspaceSandboxProps) {
  const mountRef = useRef<HTMLDivElement>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    const root = mountRef.current
    if (!root || !appId) return

    let cancelled = false
    setLoadError(null)

    void (async () => {
      try {
        let mainTs: string
        let mainCss: string
        if (inlineSources && inlineSources['main.ts']) {
          mainTs = inlineSources['main.ts']
          mainCss = inlineSources['main.css'] ?? ''
        } else {
          const mainPath = arrowAppMainTsRelative(appId)
          const cssPath = arrowAppMainCssRelative(appId)
          const readMain = await workspaceReadTextFile(
            workspaceId,
            mainPath,
            2 * 1024 * 1024,
          )
          mainTs = readMain.text
          try {
            const css = await workspaceReadTextFile(workspaceId, cssPath, 256 * 1024)
            mainCss = css.text
          } catch {
            mainCss = ''
          }
        }
        if (cancelled) return

        const source: Record<string, string> = { 'main.ts': mainTs }
        if (mainCss.trim()) {
          source['main.css'] = mainCss
        }

        const { sandbox } = await import('@arrow-js/sandbox')
        const view = sandbox(
          {
            source,
            shadowDOM,
            onError: (err) => {
              const msg = err instanceof Error ? err.message : String(err)
              onRuntimeError?.(msg)
            },
          },
          {
            output: (payload) => {
              onOutput?.(payload)
            },
          },
        )

        root.replaceChildren()
        view(root)
      } catch (e) {
        if (cancelled) return
        const msg = e instanceof Error ? e.message : String(e)
        setLoadError(msg)
        onRuntimeError?.(msg)
      }
    })()

    return () => {
      cancelled = true
      root.replaceChildren()
    }
  }, [workspaceId, appId, reloadNonce, inlineSources, shadowDOM, onOutput, onRuntimeError])

  return (
    <div
      className={cn(
        'bg-app-bg-0 text-app-text-1 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-app-border',
        className,
      )}
    >
      {loadError ? (
        <div className="text-destructive m-4 text-sm whitespace-pre-wrap">{loadError}</div>
      ) : null}
      <div ref={mountRef} className="min-h-[200px] min-w-0 flex-1" />
    </div>
  )
}
