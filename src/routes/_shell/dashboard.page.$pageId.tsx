import { createFileRoute, Link } from '@tanstack/react-router'
import { ChevronLeft } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { WorkspacePageView } from '@/components/app/workspace-dashboard-view'
import { useWorkspace } from '@/components/app/workspace-context'
import { Button } from '@/components/ui/button'
import {
  dashboardPageRelativePath,
  parseWorkspacePageJson,
  type WorkspacePage,
} from '@/lib/workspace-dashboard'
import { workspaceReadTextFile } from '@/lib/workspace-api'

export const Route = createFileRoute('/_shell/dashboard/page/$pageId')({
  component: DashboardWorkspacePage,
})

function DashboardWorkspacePage() {
  const { pageId } = Route.useParams()
  const { activeWorkspaceId, isTauriRuntime } = useWorkspace()
  const [page, setPage] = useState<WorkspacePage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!isTauriRuntime || !activeWorkspaceId) {
      setPage(null)
      setError('Desktop workspace required.')
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const rel = dashboardPageRelativePath(pageId)
      const { text } = await workspaceReadTextFile(
        activeWorkspaceId,
        rel,
        512 * 1024,
      )
      const parsed = parseWorkspacePageJson(text)
      if (!parsed.ok) {
        setError(parsed.error)
        setPage(null)
        return
      }
      if (parsed.data.pageId !== pageId) {
        setError('pageId in JSON does not match URL.')
        setPage(null)
        return
      }
      setPage(parsed.data)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      setPage(null)
    } finally {
      setLoading(false)
    }
  }, [activeWorkspaceId, isTauriRuntime, pageId])

  useEffect(() => {
    void load()
  }, [load])

  if (!isTauriRuntime) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
        <p className="text-text-2 text-center text-sm">
          In-app pages are available in the desktop app.
        </p>
        <Button variant="outline" size="sm" asChild>
          <Link to="/dashboard">Back to dashboard</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-auto">
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-5 py-8 md:px-8 md:py-12">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-text-2 -ml-2 gap-1"
            asChild
          >
            <Link to="/dashboard">
              <ChevronLeft className="size-4" aria-hidden />
              Dashboard
            </Link>
          </Button>
        </div>

        {loading ? (
          <p className="text-text-3 text-sm">Loading page…</p>
        ) : page ? (
          <WorkspacePageView page={page} />
        ) : (
          <div className="border-border bg-card/40 space-y-3 rounded-2xl border border-dashed p-6">
            <p className="text-text-2 text-sm">
              {error ?? 'Page could not be loaded.'}
            </p>
            <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
              Retry
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
