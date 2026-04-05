import { ChevronLeft, LayoutTemplate } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  WorkspaceDashboardView,
  WorkspacePageView,
} from '@/components/app/workspace-dashboard-view'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { subscribeDashboardWorkspaceMutate } from '@/lib/chat-sessions/store'
import {
  DASHBOARD_BOARD_RELATIVE_PATH,
  DASHBOARD_PAGES_DIR_RELATIVE_PATH,
  dashboardPageRelativePath,
  defaultDashboardManifest,
  parseDashboardManifestJson,
  parseWorkspacePageJson,
  type DashboardManifest,
  type WorkspacePage,
} from '@/lib/workspace-dashboard'
import { workspaceListDir, workspaceReadTextFile } from '@/lib/workspace-api'
import { cn } from '@/lib/utils'

type WorkspaceAppPreviewProps = {
  workspaceId: string
  sessionKey: string
  generating: boolean
  isTauriRuntime: boolean
  className?: string
}

export function WorkspaceAppPreview({
  workspaceId,
  sessionKey,
  generating,
  isTauriRuntime,
  className,
}: WorkspaceAppPreviewProps) {
  const [manifest, setManifest] = useState<DashboardManifest | null>(null)
  const [boardError, setBoardError] = useState<string | null>(null)
  const [boardLoading, setBoardLoading] = useState(true)
  const [pageIds, setPageIds] = useState<string[]>([])
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null)
  const [page, setPage] = useState<WorkspacePage | null>(null)
  const [pageError, setPageError] = useState<string | null>(null)
  const [pageLoading, setPageLoading] = useState(false)
  const [refreshNonce, setRefreshNonce] = useState(0)

  const bumpRefresh = useCallback(() => {
    setRefreshNonce((n) => n + 1)
  }, [])

  const loadBoard = useCallback(async () => {
    if (!isTauriRuntime || !workspaceId) {
      setManifest(null)
      setBoardError(null)
      setBoardLoading(false)
      setPageIds([])
      return
    }
    setBoardLoading(true)
    setBoardError(null)
    try {
      const { text } = await workspaceReadTextFile(
        workspaceId,
        DASHBOARD_BOARD_RELATIVE_PATH,
        512 * 1024,
      )
      const parsed = parseDashboardManifestJson(text)
      if (parsed.ok) {
        setManifest(parsed.data)
      } else {
        setBoardError(parsed.error)
        setManifest(defaultDashboardManifest())
      }
    } catch {
      setManifest(defaultDashboardManifest())
      setBoardError(null)
    } finally {
      setBoardLoading(false)
    }

    const ids: string[] = []
    try {
      const entries = await workspaceListDir(
        workspaceId,
        DASHBOARD_PAGES_DIR_RELATIVE_PATH,
      )
      for (const e of entries) {
        if (e.isDir || !e.name.endsWith('.json')) continue
        const base = e.name.slice(0, -'.json'.length)
        if (base.length > 0) ids.push(base)
      }
      ids.sort()
    } catch {
      /* pages dir may not exist */
    }
    setPageIds(ids)
  }, [isTauriRuntime, workspaceId])

  const loadPage = useCallback(
    async (pageId: string) => {
      if (!isTauriRuntime || !workspaceId) {
        setPage(null)
        setPageError(null)
        setPageLoading(false)
        return
      }
      setPageLoading(true)
      setPageError(null)
      try {
        const rel = dashboardPageRelativePath(pageId)
        const { text } = await workspaceReadTextFile(
          workspaceId,
          rel,
          512 * 1024,
        )
        const parsed = parseWorkspacePageJson(text)
        if (!parsed.ok) {
          setPageError(parsed.error)
          setPage(null)
          return
        }
        if (parsed.data.pageId !== pageId) {
          setPageError('pageId in JSON does not match file.')
          setPage(null)
          return
        }
        setPage(parsed.data)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        setPageError(msg)
        setPage(null)
      } finally {
        setPageLoading(false)
      }
    },
    [isTauriRuntime, workspaceId],
  )

  useEffect(() => {
    void loadBoard()
  }, [loadBoard, refreshNonce])

  useEffect(() => {
    return subscribeDashboardWorkspaceMutate((key) => {
      if (key === sessionKey) bumpRefresh()
    })
  }, [sessionKey, bumpRefresh])

  const prevGenerating = useRef(generating)
  useEffect(() => {
    if (prevGenerating.current && !generating) {
      bumpRefresh()
    }
    prevGenerating.current = generating
  }, [generating, bumpRefresh])

  useEffect(() => {
    if (selectedPageId) {
      void loadPage(selectedPageId)
    } else {
      setPage(null)
      setPageError(null)
      setPageLoading(false)
    }
  }, [selectedPageId, loadPage, refreshNonce])

  const onPageNavigate = useCallback((pageId: string) => {
    setSelectedPageId(pageId)
  }, [])

  const emptyBoard =
    manifest != null &&
    manifest.regions.insights.length === 0 &&
    manifest.regions.links.length === 0 &&
    manifest.regions.main.length === 0

  if (!isTauriRuntime) {
    return (
      <div
        className={cn(
          'border-border bg-card/40 flex min-h-[240px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-6 text-center',
          className,
        )}
      >
        <p className="text-text-2 text-sm leading-relaxed">
          Open the desktop app to preview{' '}
          <code className="text-text-1">.braian/dashboard/board.json</code> from
          this workspace.
        </p>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'border-border bg-card flex h-full min-h-0 flex-col overflow-hidden rounded-xl border shadow-sm',
        className,
      )}
    >
      <div className="border-border flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
        <p className="text-text-3 mr-auto text-xs font-medium tracking-wide uppercase">
          App preview
        </p>
        {selectedPageId ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-text-2 h-8 gap-1 px-2"
            onClick={() => setSelectedPageId(null)}
          >
            <ChevronLeft className="size-4 shrink-0" aria-hidden />
            Board
          </Button>
        ) : null}
        {pageIds.length > 0 ? (
          <label className="text-text-3 flex items-center gap-2 text-xs">
            <span className="sr-only">Page</span>
            <select
              className="border-border bg-background text-text-1 max-w-[10rem] rounded-md border px-2 py-1 text-xs md:max-w-[14rem]"
              value={selectedPageId ?? ''}
              onChange={(e) => {
                const v = e.target.value
                setSelectedPageId(v === '' ? null : v)
              }}
            >
              <option value="">Board only</option>
              {pageIds.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="p-3 md:p-4">
          {boardLoading ? (
            <p className="text-text-3 text-sm">Loading dashboard…</p>
          ) : selectedPageId ? (
            pageLoading ? (
              <p className="text-text-3 text-sm">Loading page…</p>
            ) : page ? (
              <WorkspacePageView page={page} onPageNavigate={onPageNavigate} />
            ) : (
              <div className="space-y-3">
                <p className="text-text-2 text-sm">
                  {pageError ?? 'Page could not be loaded.'}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void loadPage(selectedPageId)}
                >
                  Retry
                </Button>
              </div>
            )
          ) : manifest ? (
            <>
              {boardError ? (
                <div className="border-destructive/25 bg-destructive/5 mb-3 space-y-2 rounded-lg border p-3">
                  <p className="text-destructive text-sm font-medium">
                    Could not parse board.json — showing an empty layout.
                  </p>
                  <pre className="text-text-3 max-h-24 overflow-auto text-xs">
                    {boardError}
                  </pre>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => bumpRefresh()}
                  >
                    Retry
                  </Button>
                </div>
              ) : null}
              {emptyBoard ? (
                <div className="border-border bg-card/40 relative flex min-h-[200px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-6 text-center">
                  <LayoutTemplate className="text-text-3 size-10 opacity-60" />
                  <p className="text-text-2 text-sm leading-relaxed">
                    Empty board — ask the assistant to add tiles, or pick a
                    page from the menu.
                  </p>
                </div>
              ) : (
                <WorkspaceDashboardView
                  manifest={manifest}
                  onPageNavigate={onPageNavigate}
                />
              )}
            </>
          ) : (
            <p className="text-text-3 text-sm">Could not load dashboard.</p>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
