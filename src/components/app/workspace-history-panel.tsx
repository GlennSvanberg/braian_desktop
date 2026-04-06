import { History, Loader2, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from '@tanstack/react-router'

import { Button } from '@/components/ui/button'
import type { WorkspaceGitCheckpoint, WorkspaceGitStatus } from '@/lib/workspace/git-history-api'
import {
  workspaceGitEnsure,
  workspaceGitListCheckpoints,
  workspaceGitRestoreFull,
  workspaceGitSetEnabled,
  workspaceGitStatus,
} from '@/lib/workspace/git-history-api'
import { cn } from '@/lib/utils'

const SNAPSHOTS_VISIBLE = 10

function formatCheckpointTime(timeMs: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(timeMs))
  } catch {
    return new Date(timeMs).toLocaleString()
  }
}

type WorkspaceHistoryPanelProps = {
  workspaceId: string | null
  className?: string
}

export function WorkspaceHistoryPanel({
  workspaceId,
  className,
}: WorkspaceHistoryPanelProps) {
  const router = useRouter()
  const [status, setStatus] = useState<WorkspaceGitStatus | null>(null)
  const [checkpoints, setCheckpoints] = useState<WorkspaceGitCheckpoint[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [toggleBusy, setToggleBusy] = useState(false)
  const [restoreBusyOid, setRestoreBusyOid] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!workspaceId) {
      setStatus(null)
      setCheckpoints([])
      return
    }
    setLoading(true)
    setLoadError(null)
    try {
      const [s, list] = await Promise.all([
        workspaceGitStatus(workspaceId),
        workspaceGitListCheckpoints(workspaceId),
      ])
      setStatus(s)
      setCheckpoints(list)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
      setStatus(null)
      setCheckpoints([])
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const onToggleEnabled = async (next: boolean) => {
    if (!workspaceId) return
    setToggleBusy(true)
    setLoadError(null)
    try {
      await workspaceGitSetEnabled(workspaceId, next)
      if (next) {
        await workspaceGitEnsure(workspaceId)
      }
      await refresh()
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
    } finally {
      setToggleBusy(false)
    }
  }

  const onRestore = async (c: WorkspaceGitCheckpoint) => {
    if (!workspaceId) return
    const ok = window.confirm(
      [
        'Restore the entire workspace folder to this snapshot?',
        '',
        formatCheckpointTime(c.timeMs),
        c.summary,
        '',
        'Your current files are saved first on a braian-recovery-… branch.',
        'Reload open chats afterward to see updated conversations.',
      ].join('\n'),
    )
    if (!ok) return
    setRestoreBusyOid(c.oid)
    setLoadError(null)
    try {
      await workspaceGitRestoreFull(workspaceId, c.oid)
      await refresh()
      void router.invalidate()
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
    } finally {
      setRestoreBusyOid(null)
    }
  }

  const enabled = status?.enabled === true
  const canList = enabled && status?.isRepo === true
  const recent = checkpoints.slice(0, SNAPSHOTS_VISIBLE)

  return (
    <section
      className={cn(
        'border-border space-y-4 rounded-xl border p-4 shadow-sm md:p-5',
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <History
            className="text-text-3 size-5 shrink-0"
            aria-hidden
          />
          <div>
            <h2 className="text-text-1 text-base font-semibold tracking-tight">
              Workspace snapshots
            </h2>
            <p className="text-text-3 mt-1 max-w-xl text-sm leading-relaxed">
              Automatic Git checkpoints of this folder. Restore replaces all
              tracked files with that point in time.
            </p>
          </div>
        </div>
        {workspaceId ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={loading}
            onClick={() => void refresh()}
          >
            {loading ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              'Refresh'
            )}
          </Button>
        ) : null}
      </div>

      {loadError ? (
        <p className="text-destructive text-sm">{loadError}</p>
      ) : null}

      <div className="border-border flex flex-col gap-2 rounded-lg border p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-medium">Automatic checkpoints</span>
          {loading || toggleBusy ? (
            <Loader2
              className="text-text-3 size-4 animate-spin"
              aria-hidden
            />
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant={enabled ? 'secondary' : 'default'}
                disabled={!workspaceId}
                onClick={() => void onToggleEnabled(true)}
              >
                Turn on
              </Button>
              <Button
                type="button"
                size="sm"
                variant={enabled ? 'outline' : 'secondary'}
                disabled={!workspaceId || !enabled}
                onClick={() => void onToggleEnabled(false)}
              >
                Turn off
              </Button>
            </div>
          )}
        </div>
        <p className="text-text-3 text-xs leading-relaxed">
          When on, Braian creates commits after idle periods when workspace
          files change.
        </p>
        {status && enabled ? (
          <p className="text-text-3 text-xs">
            Repository: {status.isRepo ? 'ready' : 'initializing on next save'}
            {status.headOid ? (
              <>
                {' '}
                · HEAD{' '}
                <code className="text-text-2">{status.headOid.slice(0, 7)}</code>
              </>
            ) : null}
            {status.dirty ? ' · uncommitted changes pending checkpoint' : ''}
          </p>
        ) : null}
      </div>

      {!workspaceId ? (
        <p className="text-text-3 text-sm">Select a workspace to manage snapshots.</p>
      ) : loading && !status ? (
        <p className="text-text-3 text-sm">Loading snapshots…</p>
      ) : !enabled ? (
        <p className="text-text-3 text-sm">
          Turn on automatic checkpoints to record history and restore.
        </p>
      ) : !canList ? (
        <p className="text-text-3 text-sm">
          Snapshots appear after the first checkpoint (idle after a file change).
        </p>
      ) : checkpoints.length === 0 ? (
        <p className="text-text-3 text-sm">No snapshots yet.</p>
      ) : (
        <div className="space-y-2">
          <p className="text-text-3 text-xs font-medium">
            Recent snapshots
            {checkpoints.length > SNAPSHOTS_VISIBLE
              ? ` (showing ${SNAPSHOTS_VISIBLE} of ${checkpoints.length})`
              : null}
          </p>
          <ul className="space-y-2">
            {recent.map((c) => (
              <li
                key={c.oid}
                className="border-border flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-text-2 text-xs">
                    {formatCheckpointTime(c.timeMs)}
                  </p>
                  <p className="text-text-1 font-mono text-[13px] leading-snug break-all">
                    {c.summary}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="shrink-0 gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10"
                  disabled={restoreBusyOid != null}
                  onClick={() => void onRestore(c)}
                >
                  {restoreBusyOid === c.oid ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <>
                      <RotateCcw className="size-3.5 shrink-0" aria-hidden />
                      Restore
                    </>
                  )}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
