import { createFileRoute } from '@tanstack/react-router'
import { LayoutTemplate } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { WorkspaceDashboardView } from '@/components/app/workspace-dashboard-view'
import { useWorkspace } from '@/components/app/workspace-context'
import { Button } from '@/components/ui/button'
import {
  DASHBOARD_BOARD_RELATIVE_PATH,
  defaultDashboardManifest,
  parseDashboardManifestJson,
  type DashboardManifest,
} from '@/lib/workspace-dashboard'
import { isTauri } from '@/lib/tauri-env'
import { workspaceReadTextFile } from '@/lib/workspace-api'

export const Route = createFileRoute('/_shell/dashboard/')({
  component: DashboardBoardPage,
})

function DashboardBoardPage() {
  const { activeWorkspaceId, isTauriRuntime } = useWorkspace()
  const [manifest, setManifest] = useState<DashboardManifest | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    if (!isTauriRuntime || !activeWorkspaceId) {
      setManifest(defaultDashboardManifest())
      setLoadError(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setLoadError(null)
    try {
      const { text } = await workspaceReadTextFile(
        activeWorkspaceId,
        DASHBOARD_BOARD_RELATIVE_PATH,
        512 * 1024,
      )
      const parsed = parseDashboardManifestJson(text)
      if (parsed.ok) {
        setManifest(parsed.data)
      } else {
        setLoadError(parsed.error)
        setManifest(defaultDashboardManifest())
      }
    } catch {
      setManifest(defaultDashboardManifest())
      setLoadError(null)
    } finally {
      setLoading(false)
    }
  }, [activeWorkspaceId, isTauriRuntime])

  useEffect(() => {
    void reload()
  }, [reload])

  const emptyBoard =
    manifest != null &&
    manifest.regions.insights.length === 0 &&
    manifest.regions.links.length === 0 &&
    manifest.regions.main.length === 0

  return (
    <div className="flex flex-1 flex-col overflow-auto">
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-5 py-8 md:px-8 md:py-12">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <p className="text-text-3 text-xs font-medium tracking-widest uppercase">
              Overview
            </p>
            <h2 className="text-text-1 text-2xl font-semibold tracking-tight md:text-3xl">
              Dashboard
            </h2>
            <p className="text-text-2 max-w-xl text-sm leading-relaxed md:text-base">
              Workspace overview, KPIs, and in-app pages. Edit layout with Make
              app in chat (dashboard tools).
            </p>
          </div>
        </header>

        {loading ? (
          <p className="text-text-3 text-sm">Loading dashboard…</p>
        ) : !isTauri() ? (
          <div className="border-border bg-card/40 flex min-h-[280px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed p-8 text-center">
            <p className="text-text-2 text-sm leading-relaxed">
              Open the desktop app to load{' '}
              <code className="text-text-1">.braian/dashboard/board.json</code>{' '}
              from your workspace.
            </p>
          </div>
        ) : loadError ? (
          <div className="border-border bg-card/40 space-y-3 rounded-2xl border border-dashed p-6">
            <p className="text-text-2 text-sm">
              Could not parse board.json — showing an empty layout. Fix the
              file or ask Braian to regenerate it.
            </p>
            <pre className="text-text-3 max-h-32 overflow-auto rounded-lg bg-muted/50 p-3 text-xs">
              {loadError}
            </pre>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void reload()}
            >
              Retry
            </Button>
          </div>
        ) : null}

        {!loading && isTauriRuntime && manifest && !loadError ? (
          emptyBoard ? (
            <div className="border-border bg-card/40 relative flex min-h-[320px] flex-1 flex-col items-center justify-center overflow-hidden rounded-2xl border border-dashed p-8 md:min-h-[420px]">
              <div className="from-accent-500/8 pointer-events-none absolute inset-0 bg-linear-to-b to-transparent" />
              <div className="relative flex max-w-md flex-col items-center gap-4 text-center">
                <div className="bg-accent-500/12 text-accent-600 border-accent-500/20 flex size-14 items-center justify-center rounded-2xl border shadow-sm">
                  <LayoutTemplate className="size-7" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-text-1 text-lg font-semibold">
                    Nothing here yet
                  </h3>
                  <p className="text-text-2 text-sm leading-relaxed">
                    In a saved chat, select{' '}
                    <strong className="text-text-1">App</strong> in the mode
                    control and ask Braian to design your dashboard, or add{' '}
                    <code className="text-text-1">
                      .braian/dashboard/board.json
                    </code>{' '}
                    by hand.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <WorkspaceDashboardView manifest={manifest} />
          )
        ) : null}
      </div>
    </div>
  )
}
