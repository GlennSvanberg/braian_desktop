import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CloudUpload,
  Copy,
  ExternalLink,
  Loader2,
  MonitorPlay,
  MoreHorizontal,
  Package,
  Square,
} from 'lucide-react'
import { Link } from '@tanstack/react-router'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { WORKSPACE_WEBAPP_RELATIVE_DIR } from '@/lib/workspace-webapp/constants'
import {
  workspaceRunShell,
  workspaceWebappDevStart,
  workspaceWebappDevStatus,
  workspaceWebappDevStop,
  workspaceWebappInit,
  workspaceWebappPreviewPathSet,
  workspaceWebappPublish,
  workspaceWebappPublishStatus,
  type WorkspaceWebappPublishStatus,
} from '@/lib/workspace-api'
import { cn } from '@/lib/utils'

export type WebappPreviewLayout = 'published' | 'settings' | 'artifact'

export type WorkspaceWebappPreviewCoreProps = {
  workspaceId: string
  isTauriRuntime: boolean
  className?: string
  /** Published main route, webapp settings route, or App-mode artifact. */
  layout: WebappPreviewLayout
  variant?: 'full' | 'embedded'
  iframeKeyOffset?: number
  generating?: boolean
}

function isInitAlreadyExistsError(e: unknown): boolean {
  const s = e instanceof Error ? e.message : String(e)
  return s.includes('already exists')
}

export function WorkspaceWebappPreviewCore({
  workspaceId,
  isTauriRuntime,
  className,
  layout,
  variant = 'full',
  iframeKeyOffset = 0,
  generating = false,
}: WorkspaceWebappPreviewCoreProps) {
  const [status, setStatus] = useState<Awaited<
    ReturnType<typeof workspaceWebappDevStatus>
  > | null>(null)
  const [publishStatus, setPublishStatus] =
    useState<WorkspaceWebappPublishStatus | null>(null)
  const [publishError, setPublishError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [iframeKey, setIframeKey] = useState(0)
  const [pathInput, setPathInput] = useState('/')
  const prevGenerating = useRef(!!generating)
  const devUserStoppedArtifact = useRef(false)
  const publishedPrepConsumed = useRef(false)
  const artifactBootstrapConsumed = useRef(false)

  useEffect(() => {
    devUserStoppedArtifact.current = false
    publishedPrepConsumed.current = false
    artifactBootstrapConsumed.current = false
  }, [workspaceId])

  useEffect(() => {
    if (prevGenerating.current && !generating) {
      setIframeKey((k) => k + 1)
    }
    prevGenerating.current = !!generating
  }, [generating])

  useEffect(() => {
    setPathInput('/')
  }, [workspaceId])

  useEffect(() => {
    if (status?.previewPath != null && status.previewPath !== '') {
      setPathInput(status.previewPath)
    }
  }, [status?.previewPath])

  const loadDevStatus = useCallback(async () => {
    try {
      return await workspaceWebappDevStatus(workspaceId)
    } catch {
      return {
        running: false,
        hasPackageJson: false,
        hasNodeModules: false,
        lastError: 'Could not read webapp status.',
      } as Awaited<ReturnType<typeof workspaceWebappDevStatus>>
    }
  }, [workspaceId])

  const refreshStatus = useCallback(async () => {
    const s = await loadDevStatus()
    setStatus(s)
    if (layout === 'published' || layout === 'settings') {
      try {
        const p = await workspaceWebappPublishStatus(workspaceId)
        setPublishStatus(p)
      } catch {
        setPublishStatus(null)
      }
    } else {
      setPublishStatus(null)
    }
  }, [workspaceId, layout, loadDevStatus])

  useEffect(() => {
    void refreshStatus()
    const t = window.setInterval(() => void refreshStatus(), 4000)
    return () => window.clearInterval(t)
  }, [refreshStatus])

  const runNpmInstall = useCallback(async () => {
    const r = await workspaceRunShell({
      workspaceId,
      command: 'npm install',
      cwd: WORKSPACE_WEBAPP_RELATIVE_DIR,
      timeoutMs: 600_000,
      maxOutputBytes: 512_000,
    })
    if (r.exitCode !== 0) {
      setStatus((prev) => ({
        running: prev?.running ?? false,
        hasPackageJson: prev?.hasPackageJson ?? false,
        hasNodeModules: prev?.hasNodeModules ?? false,
        port: prev?.port,
        url: prev?.url,
        previewPath: prev?.previewPath,
        previewUrl: prev?.previewUrl,
        lastError: `npm install failed (exit ${r.exitCode}).\n${r.stderr || r.stdout}`,
      }))
    }
    await refreshStatus()
  }, [workspaceId, refreshStatus])

  /** Published page: silent init + npm so Publish works without opening settings. */
  useEffect(() => {
    if (!isTauriRuntime || layout !== 'published' || !status || busy !== null) {
      return
    }
    if (publishedPrepConsumed.current) {
      return
    }
    if (status.hasPackageJson && status.hasNodeModules) {
      publishedPrepConsumed.current = true
      return
    }
    publishedPrepConsumed.current = true
    void (async () => {
      setBusy('prep-published')
      try {
        if (!status.hasPackageJson) {
          try {
            await workspaceWebappInit({ workspaceId, overwrite: false })
          } catch (e) {
            if (!isInitAlreadyExistsError(e)) {
              setStatus((prev) => ({
                running: false,
                hasPackageJson: prev?.hasPackageJson ?? false,
                hasNodeModules: prev?.hasNodeModules ?? false,
                lastError: e instanceof Error ? e.message : String(e),
              }))
              return
            }
          }
        }
        const s = await loadDevStatus()
        if (!s.hasNodeModules) {
          await runNpmInstall()
        }
        await refreshStatus()
      } finally {
        setBusy(null)
      }
    })()
  }, [
    isTauriRuntime,
    layout,
    status?.hasPackageJson,
    status?.hasNodeModules,
    busy,
    workspaceId,
    loadDevStatus,
    runNpmInstall,
    refreshStatus,
  ])

  /** Artifact: one-shot init → npm → dev start (no auto-restart after user Stop). */
  useEffect(() => {
    if (!isTauriRuntime || layout !== 'artifact' || !status || busy !== null) {
      return
    }
    const needsInit = !status.hasPackageJson
    const needsNpm = !status.hasNodeModules
    const needsStart = !status.running && !devUserStoppedArtifact.current
    if (!needsInit && !needsNpm && !needsStart) {
      return
    }
    if (artifactBootstrapConsumed.current) {
      return
    }
    artifactBootstrapConsumed.current = true
    void (async () => {
      setBusy('bootstrap')
      try {
        if (needsInit) {
          try {
            await workspaceWebappInit({ workspaceId, overwrite: false })
          } catch (e) {
            if (!isInitAlreadyExistsError(e)) {
              setStatus((prev) => ({
                running: false,
                hasPackageJson: prev?.hasPackageJson ?? false,
                hasNodeModules: prev?.hasNodeModules ?? false,
                lastError: e instanceof Error ? e.message : String(e),
              }))
              return
            }
          }
        }
        let s = await loadDevStatus()
        if (!s.hasNodeModules) {
          await runNpmInstall()
          s = await loadDevStatus()
        }
        if (!s.running && !devUserStoppedArtifact.current) {
          try {
            await workspaceWebappDevStart(workspaceId)
            setIframeKey((k) => k + 1)
          } catch (e) {
            setStatus((prev) => ({
              ...prev,
              running: prev?.running ?? false,
              hasPackageJson: s.hasPackageJson,
              hasNodeModules: s.hasNodeModules,
              lastError: e instanceof Error ? e.message : String(e),
            }))
          }
        }
        await refreshStatus()
      } finally {
        setBusy(null)
      }
    })()
  }, [
    isTauriRuntime,
    layout,
    status?.hasPackageJson,
    status?.hasNodeModules,
    status?.running,
    busy,
    workspaceId,
    loadDevStatus,
    runNpmInstall,
    refreshStatus,
  ])

  const onInit = async () => {
    setBusy('init')
    try {
      await workspaceWebappInit({ workspaceId, overwrite: false })
      await refreshStatus()
    } catch (e) {
      setStatus((prev) => ({
        running: false,
        hasPackageJson: prev?.hasPackageJson ?? false,
        hasNodeModules: prev?.hasNodeModules ?? false,
        lastError: e instanceof Error ? e.message : String(e),
      }))
    } finally {
      setBusy(null)
    }
  }

  const onInitOverwrite = async () => {
    setBusy('init')
    try {
      await workspaceWebappInit({ workspaceId, overwrite: true })
      await refreshStatus()
    } catch (e) {
      setStatus((prev) => ({
        running: false,
        hasPackageJson: prev?.hasPackageJson ?? false,
        hasNodeModules: prev?.hasNodeModules ?? false,
        lastError: e instanceof Error ? e.message : String(e),
      }))
    } finally {
      setBusy(null)
    }
  }

  const onNpmInstall = async () => {
    setBusy('npm')
    try {
      await runNpmInstall()
    } catch (e) {
      setStatus((prev) => ({
        running: prev?.running ?? false,
        hasPackageJson: prev?.hasPackageJson ?? false,
        hasNodeModules: prev?.hasNodeModules ?? false,
        lastError: e instanceof Error ? e.message : String(e),
      }))
    } finally {
      setBusy(null)
    }
  }

  const onPublish = async () => {
    setBusy('publish')
    setPublishError(null)
    try {
      const r = await workspaceWebappPublish(workspaceId)
      if (!r.ok) {
        setPublishError(r.logSummary ?? 'Build failed.')
      } else {
        setIframeKey((k) => k + 1)
      }
      await refreshStatus()
    } catch (e) {
      setPublishError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const onStart = async () => {
    devUserStoppedArtifact.current = false
    setBusy('start')
    try {
      await workspaceWebappDevStart(workspaceId)
      setIframeKey((k) => k + 1)
      await refreshStatus()
    } catch (e) {
      setStatus((prev) => ({
        running: false,
        hasPackageJson: prev?.hasPackageJson ?? false,
        hasNodeModules: prev?.hasNodeModules ?? false,
        lastError: e instanceof Error ? e.message : String(e),
      }))
    } finally {
      setBusy(null)
    }
  }

  const onStop = async () => {
    if (layout === 'artifact') {
      devUserStoppedArtifact.current = true
    }
    setBusy('stop')
    try {
      await workspaceWebappDevStop(workspaceId)
      await refreshStatus()
    } catch (e) {
      setStatus((prev) => ({
        running: status?.running ?? false,
        hasPackageJson: prev?.hasPackageJson ?? false,
        hasNodeModules: prev?.hasNodeModules ?? false,
        port: prev?.port,
        url: prev?.url,
        previewPath: prev?.previewPath,
        previewUrl: prev?.previewUrl,
        lastError: e instanceof Error ? e.message : String(e),
      }))
    } finally {
      setBusy(null)
    }
  }

  const onApplyPreviewPath = async () => {
    setBusy('path')
    try {
      await workspaceWebappPreviewPathSet({
        workspaceId,
        path: pathInput.trim() || '/',
      })
      setIframeKey((k) => k + 1)
      await refreshStatus()
    } catch (e) {
      setStatus((prev) => ({
        running: prev?.running ?? false,
        hasPackageJson: prev?.hasPackageJson ?? false,
        hasNodeModules: prev?.hasNodeModules ?? false,
        port: prev?.port,
        url: prev?.url,
        previewPath: prev?.previewPath,
        previewUrl: prev?.previewUrl,
        lastError: e instanceof Error ? e.message : String(e),
      }))
    } finally {
      setBusy(null)
    }
  }

  const copyDevUrl = async () => {
    const href =
      status?.running && status.previewUrl
        ? status.previewUrl
        : status?.url
    if (!href) return
    try {
      await navigator.clipboard.writeText(href)
    } catch {
      /* ignore */
    }
  }

  const webHint =
    'Requires Node.js and npm on your PATH. The Vite app lives in ' +
    WORKSPACE_WEBAPP_RELATIVE_DIR +
    '.'

  const embedded = variant === 'embedded'
  const publishedUrl = publishStatus?.publishedPreviewUrl ?? null
  const showPublishedIframe =
    layout === 'published' && Boolean(publishedUrl)
  const preppingPublished = busy === 'prep-published'
  const bootstrappingArtifact = busy === 'bootstrap'

  const settingsButtonRow = (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="default"
        size="sm"
        disabled={busy !== null}
        onClick={() => void onInit()}
      >
        {busy === 'init' ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : null}
        Init from template
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy !== null}
        onClick={() => void onInitOverwrite()}
      >
        Reset template (overwrite)
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy !== null}
        onClick={() => void onNpmInstall()}
      >
        {busy === 'npm' ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <Package className="size-4" aria-hidden />
        )}
        Install deps
      </Button>
      <Button
        type="button"
        variant="default"
        size="sm"
        disabled={busy !== null}
        onClick={() => void onPublish()}
      >
        {busy === 'publish' ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <CloudUpload className="size-4" aria-hidden />
        )}
        Publish
      </Button>
    </div>
  )

  const previewPathRow = (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <label
        htmlFor={`webapp-preview-path-${workspaceId}`}
        className="text-text-3 shrink-0 text-xs whitespace-nowrap"
      >
        Preview path
      </label>
      <Input
        id={`webapp-preview-path-${workspaceId}`}
        value={pathInput}
        onChange={(e) => setPathInput(e.target.value)}
        placeholder="/calculator"
        className="border-border bg-background text-text-1 h-8 min-w-[8rem] flex-1 font-mono text-xs md:max-w-xs"
        disabled={busy !== null}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void onApplyPreviewPath()
          }
        }}
      />
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={busy !== null}
        onClick={() => void onApplyPreviewPath()}
      >
        {busy === 'path' ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : null}
        Apply
      </Button>
    </div>
  )

  const devControlsRow = (
    <div className="flex flex-wrap items-center gap-2">
      {status?.running ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={busy !== null}
          onClick={() => void onStop()}
        >
          {busy === 'stop' ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Square className="size-4" aria-hidden />
          )}
          Stop dev preview
        </Button>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy !== null}
          onClick={() => void onStart()}
        >
          {busy === 'start' ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <MonitorPlay className="size-4" aria-hidden />
          )}
          Start dev preview
        </Button>
      )}
      {status?.url ? (
        <>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void copyDevUrl()}
          >
            <Copy className="size-4" aria-hidden />
            Copy dev URL
          </Button>
          <Button type="button" variant="ghost" size="sm" asChild>
            <a
              href={
                status.previewUrl && status.running
                  ? status.previewUrl
                  : status.url
              }
              target="_blank"
              rel="noreferrer"
              className="gap-1.5"
            >
              <ExternalLink className="size-4" aria-hidden />
              Open dev in browser
            </a>
          </Button>
        </>
      ) : null}
    </div>
  )

  const artifactAdvancedMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy !== null && busy !== 'bootstrap'}
          className="gap-1.5"
        >
          <MoreHorizontal className="size-4" aria-hidden />
          Advanced
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[14rem]">
        <DropdownMenuItem
          disabled={busy !== null}
          onSelect={() => void onInit()}
        >
          Init from template
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={busy !== null}
          onSelect={() => void onInitOverwrite()}
        >
          Reset template (overwrite)
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={busy !== null}
          onSelect={() => void onNpmInstall()}
        >
          Install deps
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={busy !== null}
          onSelect={() => void onPublish()}
        >
          Publish (sidebar build)
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {status?.running ? (
          <DropdownMenuItem
            disabled={busy !== null}
            onSelect={() => void onStop()}
          >
            Stop dev preview
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            disabled={busy !== null}
            onSelect={() => void onStart()}
          >
            Start dev preview
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  const publishedFullBleed = layout === 'published' && !embedded

  return (
    <div
      className={cn(
        embedded
          ? 'flex min-h-0 flex-1 flex-col gap-2 p-2 md:p-3'
          : publishedFullBleed
            ? 'flex h-full min-h-0 flex-1 flex-col gap-0 p-0'
            : 'flex min-h-0 flex-1 flex-col gap-4 p-4 md:p-6',
        className,
      )}
    >
      {!embedded && layout !== 'published' ? (
        <header className="space-y-1">
          <h1 className="text-text-1 text-xl font-semibold tracking-tight md:text-2xl">
            {layout === 'settings' ? 'Webapp settings' : 'Workspace webapp'}
          </h1>
          <p className="text-text-2 max-w-2xl text-sm leading-relaxed">
            {layout === 'settings' ? (
              <>
                {webHint} Manage the Vite project, dev server, and publishing.{' '}
                <Link
                  to="/workspace/$workspaceId/webapp"
                  params={{ workspaceId }}
                  className="text-text-1 font-medium underline-offset-2 hover:underline"
                >
                  Open published view
                </Link>
                .
              </>
            ) : (
              <>
                {webHint}{' '}
                <strong className="text-text-1 font-medium">Dev preview</strong> (hot
                reload) starts automatically when possible. The sidebar{' '}
                <strong className="text-text-1 font-medium">Webapp</strong> page shows the
                published build. Use <strong className="text-text-1 font-medium">
                  Advanced
                </strong>{' '}
                for manual steps or <strong className="text-text-1 font-medium">
                  Publish
                </strong>{' '}
                to refresh the sidebar.
              </>
            )}
          </p>
        </header>
      ) : null}
      {embedded ? (
        <div className="flex flex-wrap items-center gap-2 px-0.5">
          {artifactAdvancedMenu}
          {bootstrappingArtifact || busy === 'prep-published' ? (
            <span className="text-text-3 inline-flex items-center gap-1.5 text-xs">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              Preparing preview…
            </span>
          ) : null}
        </div>
      ) : null}

      {!isTauriRuntime ? (
        <p
          className={cn(
            'text-text-3 text-sm',
            publishedFullBleed && 'p-4',
          )}
        >
          Web preview is only available in the Braian Desktop app.
        </p>
      ) : layout === 'published' ? (
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          {publishError ? (
            <div className="border-destructive/40 bg-destructive/10 text-destructive absolute top-2 right-2 left-2 z-20 max-h-36 overflow-auto rounded-md border px-3 py-2 text-xs whitespace-pre-wrap shadow-sm">
              {publishError}
            </div>
          ) : null}
          {preppingPublished ? (
            <div className="bg-background/85 absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 backdrop-blur-[1px]">
              <Loader2
                className="text-text-2 size-8 animate-spin"
                aria-hidden
              />
              <p className="text-text-2 text-sm">Preparing project…</p>
            </div>
          ) : null}
          {showPublishedIframe ? (
            <iframe
              key={
                iframeKey +
                iframeKeyOffset +
                (publishStatus?.publishedAtMs ?? 0)
              }
              title="Published workspace webapp"
              src={publishedUrl!}
              className="min-h-0 w-full flex-1 border-0 bg-[var(--app-bg-0)]"
            />
          ) : (
            <div className="text-text-3 flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-sm">
              <p className="text-text-2">Nothing published yet.</p>
              <p className="text-text-3 max-w-sm text-xs leading-relaxed">
                Use the <strong className="text-text-2">gear</strong> next to Webapp in
                the sidebar to publish and manage the app.
              </p>
            </div>
          )}
        </div>
      ) : layout === 'settings' ? (
        <>
          {settingsButtonRow}
          {publishError ? (
            <div className="border-destructive/30 bg-destructive/5 text-destructive max-h-48 overflow-auto rounded-lg border px-3 py-2 text-xs whitespace-pre-wrap">
              {publishError}
            </div>
          ) : null}
          {previewPathRow}
          {status?.lastError ? (
            <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-lg border px-3 py-2 text-sm whitespace-pre-wrap">
              {status.lastError}
            </div>
          ) : null}
          <div className="border-border space-y-3 border-t pt-4">
            <h2 className="text-text-1 text-sm font-semibold tracking-tight">
              Dev preview (hot reload)
            </h2>
            <p className="text-text-3 max-w-2xl text-xs leading-relaxed">
              Live Vite server for editing. The published page does not update until you
              publish again.
            </p>
            {devControlsRow}
          </div>
        </>
      ) : (
        <>
          {!embedded ? (
            <div className="flex flex-wrap items-center gap-2">
              {artifactAdvancedMenu}
              {bootstrappingArtifact ? (
                <span className="text-text-3 inline-flex items-center gap-1.5 text-xs">
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  Preparing preview…
                </span>
              ) : null}
            </div>
          ) : null}
          {previewPathRow}
          {publishError ? (
            <div className="border-destructive/30 bg-destructive/5 text-destructive max-h-48 overflow-auto rounded-lg border px-3 py-2 text-xs whitespace-pre-wrap">
              {publishError}
            </div>
          ) : null}
          {status?.lastError ? (
            <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-lg border px-3 py-2 text-sm whitespace-pre-wrap">
              {status.lastError}
            </div>
          ) : null}
          <div
            className={cn(
              'border-border bg-card flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border shadow-sm',
              embedded ? 'min-h-[200px]' : 'min-h-[420px]',
            )}
          >
            {status?.running && (status.previewUrl ?? status.url) ? (
              <iframe
                key={iframeKey + iframeKeyOffset}
                title="Workspace webapp dev preview"
                src={status.previewUrl ?? status.url}
                className="h-full min-h-[200px] w-full flex-1 border-0 bg-[var(--app-bg-0)]"
              />
            ) : (
              <div className="text-text-3 flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm">
                <p>Dev preview is not running.</p>
                <p className="max-w-md">
                  {bootstrappingArtifact ? (
                    <>Starting the dev server…</>
                  ) : (
                    <>
                      Use <strong className="text-text-2">Advanced</strong> to start the
                      preview or fix setup.
                    </>
                  )}
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
