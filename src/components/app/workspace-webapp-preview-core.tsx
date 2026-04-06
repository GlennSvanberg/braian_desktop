import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CloudUpload,
  Copy,
  ExternalLink,
  Loader2,
  MonitorPlay,
  Package,
  Square,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
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

export type WorkspaceWebappPreviewCoreProps = {
  workspaceId: string
  isTauriRuntime: boolean
  className?: string
  /** Sidebar: published app + publish; artifact: dev preview for editing. */
  surface?: 'sidebar' | 'artifact'
  /** Page route: title + long help. Embedded: compact chrome for artifact rail. */
  variant?: 'full' | 'embedded'
  /** Parent can bump after AI edits to force iframe reload. */
  iframeKeyOffset?: number
  /** When this flips from true to false (turn finished), reload the iframe once. */
  generating?: boolean
}

export function WorkspaceWebappPreviewCore({
  workspaceId,
  isTauriRuntime,
  className,
  surface = 'sidebar',
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

  const refreshStatus = useCallback(async () => {
    try {
      const s = await workspaceWebappDevStatus(workspaceId)
      setStatus(s)
      if (surface === 'sidebar') {
        try {
          const p = await workspaceWebappPublishStatus(workspaceId)
          setPublishStatus(p)
        } catch {
          setPublishStatus(null)
        }
      }
    } catch {
      setStatus({
        running: false,
        lastError: 'Could not read webapp status.',
      })
      if (surface === 'sidebar') {
        setPublishStatus(null)
      }
    }
  }, [workspaceId, surface])

  useEffect(() => {
    void refreshStatus()
    const t = window.setInterval(() => void refreshStatus(), 4000)
    return () => window.clearInterval(t)
  }, [refreshStatus])

  const onInit = async () => {
    setBusy('init')
    try {
      await workspaceWebappInit({ workspaceId, overwrite: false })
      await refreshStatus()
    } catch (e) {
      setStatus({
        running: false,
        lastError: e instanceof Error ? e.message : String(e),
      })
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
      setStatus({
        running: false,
        lastError: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setBusy(null)
    }
  }

  const onNpmInstall = async () => {
    setBusy('npm')
    try {
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
          port: prev?.port,
          url: prev?.url,
          previewPath: prev?.previewPath,
          previewUrl: prev?.previewUrl,
          lastError: `npm install failed (exit ${r.exitCode}).\n${r.stderr || r.stdout}`,
        }))
      }
      await refreshStatus()
    } catch (e) {
      setStatus({
        running: false,
        lastError: e instanceof Error ? e.message : String(e),
      })
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
    setBusy('start')
    try {
      await workspaceWebappDevStart(workspaceId)
      setIframeKey((k) => k + 1)
      await refreshStatus()
    } catch (e) {
      setStatus({
        running: false,
        lastError: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setBusy(null)
    }
  }

  const onStop = async () => {
    setBusy('stop')
    try {
      await workspaceWebappDevStop(workspaceId)
      await refreshStatus()
    } catch (e) {
      setStatus({
        running: status?.running ?? false,
        port: status?.port,
        url: status?.url,
        previewPath: status?.previewPath,
        previewUrl: status?.previewUrl,
        lastError: e instanceof Error ? e.message : String(e),
      })
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

  const copyPublishedUrl = async () => {
    const href = publishStatus?.publishedPreviewUrl
    if (!href) return
    try {
      await navigator.clipboard.writeText(href)
    } catch {
      /* ignore */
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
    'Requires Node.js and npm on your PATH. One Vite app per workspace lives in ' +
    WORKSPACE_WEBAPP_RELATIVE_DIR +
    '.'

  const embedded = variant === 'embedded'
  const isSidebar = surface === 'sidebar'

  const publishedUrl = publishStatus?.publishedPreviewUrl ?? null
  const showPublishedIframe = isSidebar && Boolean(publishedUrl)

  return (
    <div
      className={cn(
        embedded
          ? 'flex min-h-0 flex-1 flex-col gap-2 p-2 md:p-3'
          : 'flex min-h-0 flex-1 flex-col gap-4 p-4 md:p-6',
        className,
      )}
    >
      {!embedded ? (
        <header className="space-y-1">
          <h1 className="text-text-1 text-xl font-semibold tracking-tight md:text-2xl">
            Workspace webapp
          </h1>
          <p className="text-text-2 max-w-2xl text-sm leading-relaxed">
            {isSidebar ? (
              <>
                {webHint} Use <strong className="text-text-1 font-medium">Init</strong>,{' '}
                <strong className="text-text-1 font-medium">Install deps</strong>, then{' '}
                <strong className="text-text-1 font-medium">Publish</strong> to show the
                production build here. The sidebar always shows the{' '}
                <strong className="text-text-1 font-medium">last published</strong> version
                until you publish again. Use <strong className="text-text-1 font-medium">
                  Dev preview
                </strong>{' '}
                below for hot reload while editing.
              </>
            ) : (
              <>
                {webHint} This panel is for{' '}
                <strong className="text-text-1 font-medium">Dev preview</strong> (hot
                reload). The <strong className="text-text-1 font-medium">Webapp</strong>{' '}
                sidebar shows the published build. Use{' '}
                <strong className="text-text-1 font-medium">Publish</strong> on that page
                (or below) to update what the sidebar shows.
              </>
            )}
          </p>
        </header>
      ) : (
        <div className="space-y-1 px-0.5">
          <p className="text-text-3 text-xs leading-snug">
            Vite app in{' '}
            <code className="text-text-2">{WORKSPACE_WEBAPP_RELATIVE_DIR}</code> — Init,
            install, then <strong className="text-text-2">Start preview</strong> for hot
            reload. Sidebar Webapp shows the published build; publish from there or use
            Publish below.
          </p>
        </div>
      )}

      {!isTauriRuntime ? (
        <p className="text-text-3 text-sm">
          Web preview is only available in the Braian Desktop app.
        </p>
      ) : (
        <>
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
            {!embedded ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy !== null}
                onClick={() => void onInitOverwrite()}
              >
                Reset template (overwrite)
              </Button>
            ) : null}
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
            {isSidebar ? (
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
            ) : (
              <Button
                type="button"
                variant="secondary"
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
            )}
          </div>

          {isSidebar &&
          publishStatus?.hasUnpublishedChanges &&
          publishStatus.hasPublishedDist ? (
            <div className="border-border bg-muted/40 text-text-2 rounded-lg border px-3 py-2 text-sm">
              Unpublished changes — the sidebar still shows the last published version
              until you <strong className="text-text-1 font-medium">Publish</strong>.
            </div>
          ) : null}

          {isSidebar &&
          publishStatus?.hasUnpublishedChanges &&
          !publishStatus.hasPublishedDist ? (
            <div className="border-border bg-muted/40 text-text-2 rounded-lg border px-3 py-2 text-sm">
              No published build yet. Run <strong className="text-text-1 font-medium">
                Publish
              </strong>{' '}
              after install to show the app here.
            </div>
          ) : null}

          {publishError ? (
            <div className="border-destructive/30 bg-destructive/5 text-destructive max-h-48 overflow-auto rounded-lg border px-3 py-2 text-xs whitespace-pre-wrap">
              {publishError}
            </div>
          ) : null}

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

          {isSidebar && publishedUrl ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void copyPublishedUrl()}
              >
                <Copy className="size-4" aria-hidden />
                Copy published URL
              </Button>
              <Button type="button" variant="ghost" size="sm" asChild>
                <a
                  href={publishedUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="gap-1.5"
                >
                  <ExternalLink className="size-4" aria-hidden />
                  Open published in browser
                </a>
              </Button>
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
            {isSidebar ? (
              showPublishedIframe ? (
                <iframe
                  key={
                    iframeKey +
                    iframeKeyOffset +
                    (publishStatus?.publishedAtMs ?? 0)
                  }
                  title="Published workspace webapp"
                  src={publishedUrl!}
                  className="h-full min-h-[200px] w-full flex-1 border-0 bg-[var(--app-bg-0)]"
                />
              ) : (
                <div className="text-text-3 flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm">
                  <p>No published app to show yet.</p>
                  <p className="max-w-md">
                    After <strong className="text-text-2">Init</strong> and{' '}
                    <strong className="text-text-2">Install deps</strong>, choose{' '}
                    <strong className="text-text-2">Publish</strong> to build and load the
                    app here. Use <strong className="text-text-2">Dev preview</strong>{' '}
                    below while editing; publish again when you want the sidebar to match.
                  </p>
                </div>
              )
            ) : status?.running && (status.previewUrl ?? status.url) ? (
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
                  After <strong className="text-text-2">Init</strong> and{' '}
                  <strong className="text-text-2">Install deps</strong>, choose{' '}
                  <strong className="text-text-2">Start preview</strong> to load the Vite
                  dev server here.
                </p>
              </div>
            )}
          </div>

          {isSidebar ? (
            <div className="border-border space-y-3 border-t pt-4">
              <h2 className="text-text-1 text-sm font-semibold tracking-tight">
                Dev preview (hot reload)
              </h2>
              <p className="text-text-3 max-w-2xl text-xs leading-relaxed">
                Live Vite server for editing. Changes are not shown in the published
                iframe above until you publish.
              </p>
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
            </div>
          ) : (
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
                  Stop preview
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => void onStart()}
                >
                  {busy === 'start' ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <MonitorPlay className="size-4" aria-hidden />
                  )}
                  Start preview
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
                    Copy URL
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
                      Open in browser
                    </a>
                  </Button>
                </>
              ) : null}
            </div>
          )}
        </>
      )}
    </div>
  )
}
