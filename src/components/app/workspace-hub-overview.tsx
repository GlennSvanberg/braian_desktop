import { Link, useNavigate } from '@tanstack/react-router'
import {
  ArrowRight,
  Calculator,
  FileText,
  LayoutDashboard,
  MessageSquare,
  Sparkles,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { WorkspaceFolderManagementPanel } from '@/components/app/workspace-folder-management-panel'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { workspaceMcpConfigGet } from '@/lib/connections-api'
import {
  resolveHubSections,
  type HubDashboardSection,
  type WorkspaceHubSnapshot,
} from '@/lib/workspace-hub-types'
import { workspaceHubSnapshot } from '@/lib/workspace-hub-api'
import type { ConversationDto } from '@/lib/workspace-api'
import {
  workspaceReadTextFile,
  workspaceWebappPreviewPathSet,
  workspaceWebappPublishStatus,
} from '@/lib/workspace-api'
import { workspaceGitListCheckpoints, workspaceGitStatus } from '@/lib/workspace/git-history-api'
import { isTauri } from '@/lib/tauri-env'
import { cn } from '@/lib/utils'

type Props = {
  workspaceId: string
  workspaceName: string
  isTauriRuntime: boolean
  conversations: ConversationDto[]
}

function sectionCardClass() {
  return 'border-border bg-card h-full rounded-xl border p-4 shadow-sm md:p-5'
}

/** Tile span in the main hub grid (welcome is rendered outside this grid). */
function hubGridSpanClass(type: HubDashboardSection['type']): string {
  if (type === 'kpis') {
    return 'lg:col-span-2 2xl:col-span-3'
  }
  if (type === 'insights') {
    /* One full row on three-column layouts so the strip does not leave dead cells. */
    return '2xl:col-span-3'
  }
  return ''
}

function memorySnippetFromText(text: string, maxLen: number): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  if (oneLine.length <= maxLen) return oneLine
  return `${oneLine.slice(0, maxLen - 1)}…`
}

function formatShortTime(ms: number): string {
  const d = Date.now() - ms
  if (d < 60_000) return 'Just now'
  if (d < 3600_000) return `${Math.floor(d / 60_000)}m ago`
  if (d < 86400_000) return `${Math.floor(d / 3600_000)}h ago`
  return new Date(ms).toLocaleDateString()
}

export function WorkspaceHubOverview({
  workspaceId,
  workspaceName,
  isTauriRuntime,
  conversations,
}: Props) {
  const navigate = useNavigate()
  const [snapshot, setSnapshot] = useState<WorkspaceHubSnapshot | null>(() =>
    isTauri()
      ? null
      : {
          dashboard: null,
          webappAppRoutes: [],
          recentFiles: [],
          insightItems: [],
        },
  )
  const [loadError, setLoadError] = useState<string | null>(null)
  const [memorySnippet, setMemorySnippet] = useState<string | null>(null)
  const [publishStatus, setPublishStatus] = useState<Awaited<
    ReturnType<typeof workspaceWebappPublishStatus>
  > | null>(null)
  const [gitStatus, setGitStatus] = useState<Awaited<
    ReturnType<typeof workspaceGitStatus>
  > | null>(null)
  const [lastCheckpointMs, setLastCheckpointMs] = useState<number | null>(null)
  const [mcpServerCount, setMcpServerCount] = useState<number>(0)

  const reload = useCallback(async () => {
    if (!isTauriRuntime) {
      setSnapshot({
        dashboard: null,
        webappAppRoutes: [],
        recentFiles: [],
        insightItems: [],
      })
      setPublishStatus(null)
      setGitStatus(null)
      setLastCheckpointMs(null)
      setMcpServerCount(0)
      return
    }
    setLoadError(null)
    try {
      const [snap, pub, gs, mcp, mem] = await Promise.all([
        workspaceHubSnapshot(workspaceId),
        workspaceWebappPublishStatus(workspaceId),
        workspaceGitStatus(workspaceId),
        workspaceMcpConfigGet(workspaceId),
        workspaceReadTextFile(workspaceId, 'MEMORY.md', 8192).catch(() => null),
      ])
      setSnapshot(snap)
      setPublishStatus(pub)
      setGitStatus(gs)
      setMcpServerCount(Object.keys(mcp.mcpServers ?? {}).length)
      if (mem?.text?.trim()) {
        setMemorySnippet(memorySnippetFromText(mem.text, 220))
      } else {
        setMemorySnippet(null)
      }
      const checkpoints = await workspaceGitListCheckpoints(workspaceId)
      const last = checkpoints[0]
      setLastCheckpointMs(last?.timeMs ?? null)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load overview.')
    }
  }, [isTauriRuntime, workspaceId])

  useEffect(() => {
    void reload()
  }, [reload])

  const sections = useMemo(
    () => resolveHubSections(snapshot?.dashboard ?? null),
    [snapshot?.dashboard],
  )

  const welcomeSections = useMemo(
    () => sections.filter((s) => s.type === 'welcome'),
    [sections],
  )

  const bodySections = useMemo(
    () => sections.filter((s) => s.type !== 'welcome'),
    [sections],
  )

  const sortedConversations = useMemo(() => {
    const list = [...conversations]
    list.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return b.updatedAtMs - a.updatedAtMs
    })
    return list.slice(0, 8)
  }, [conversations])

  const unreadCount = useMemo(
    () => conversations.filter((c) => c.unread).length,
    [conversations],
  )

  const heuristicInsights = useMemo(() => {
    const lines: string[] = []
    if (unreadCount > 0) {
      lines.push(
        `You have ${unreadCount} conversation${unreadCount === 1 ? '' : 's'} with new activity.`,
      )
    }
    if (publishStatus?.hasUnpublishedChanges) {
      lines.push('The workspace app has changes that are not published yet.')
    }
    if (mcpServerCount === 0) {
      lines.push('No MCP connections configured — add servers in workspace settings if you use tools.')
    } else {
      lines.push(`${mcpServerCount} MCP server${mcpServerCount === 1 ? '' : 's'} in this workspace’s config.`)
    }
    if (gitStatus?.enabled && lastCheckpointMs) {
      lines.push(`Last Git checkpoint: ${formatShortTime(lastCheckpointMs)}.`)
    }
    return lines
  }, [
    unreadCount,
    publishStatus?.hasUnpublishedChanges,
    mcpServerCount,
    gitStatus?.enabled,
    lastCheckpointMs,
  ])

  const openAppRoute = useCallback(
    async (path: string) => {
      if (!isTauriRuntime) return
      try {
        await workspaceWebappPreviewPathSet({ workspaceId, path })
        void navigate({ to: '/dashboard', search: { tab: 'apps' }, replace: false })
      } catch (e) {
        console.error('[braian] preview path', e)
      }
    },
    [isTauriRuntime, navigate, workspaceId],
  )

  const renderSection = (s: HubDashboardSection) => {
    switch (s.type) {
      case 'welcome':
        return (
          <section className={sectionCardClass()}>
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0 space-y-2">
                <p className="text-text-3 text-xs font-semibold tracking-widest uppercase">
                  Workspace
                </p>
                <h2 className="text-text-1 text-xl font-semibold tracking-tight md:text-2xl">
                  Welcome back
                </h2>
                <p className="text-text-2 max-w-3xl text-sm leading-relaxed lg:max-w-none lg:text-pretty">
                  {memorySnippet ??
                    `You’re in ${workspaceName}. Pick up a chat, open a published app, or attach files from the tree.`}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button type="button" variant="default" size="sm" asChild>
                  <Link to="/chat/new">New agent</Link>
                </Button>
                <Button type="button" variant="outline" size="sm" asChild>
                  <Link to="/dashboard" search={{ tab: 'apps' }}>
                    <LayoutDashboard className="size-3.5" aria-hidden />
                    Apps
                  </Link>
                </Button>
                <Button type="button" variant="outline" size="sm" asChild>
                  <Link to="/workspace/$workspaceId/settings" params={{ workspaceId }}>
                    Workspace settings
                  </Link>
                </Button>
              </div>
            </div>
          </section>
        )
      case 'continue':
        return (
          <section className={sectionCardClass()}>
            <div className="mb-4 flex items-center gap-2">
              <MessageSquare className="text-text-3 size-4" aria-hidden />
              <h3 className="text-text-1 text-sm font-semibold">Continue</h3>
            </div>
            {sortedConversations.length === 0 ? (
              <p className="text-text-3 text-sm">No conversations yet. Start a new agent to begin.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {sortedConversations.map((c) => (
                  <li key={c.id}>
                    <Link
                      to="/chat/$conversationId"
                      params={{ conversationId: c.id }}
                      className="border-border bg-muted/20 hover:bg-muted/40 flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors"
                    >
                      <span className="text-text-1 min-w-0 truncate font-medium">
                        {c.pinned ? '· ' : ''}
                        {c.title}
                      </span>
                      <span className="text-text-3 shrink-0 text-xs">
                        {formatShortTime(c.updatedAtMs)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )
      case 'kpis':
        return (
          <section className={sectionCardClass()}>
            <h3 className="text-text-1 mb-4 text-sm font-semibold">At a glance</h3>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="border-border bg-muted/15 rounded-lg border px-3 py-3">
                <p className="text-text-3 text-xs font-medium">Chats</p>
                <p className="text-text-1 mt-1 text-2xl font-semibold tabular-nums">
                  {conversations.length}
                </p>
                {unreadCount > 0 ? (
                  <p className="text-primary mt-0.5 text-xs">{unreadCount} unread</p>
                ) : null}
              </div>
              <div className="border-border bg-muted/15 rounded-lg border px-3 py-3">
                <p className="text-text-3 text-xs font-medium">Published app</p>
                <p className="text-text-1 mt-1 text-sm font-medium leading-snug">
                  {publishStatus?.hasPublishedDist ? 'Built' : 'Not built'}
                </p>
                {publishStatus?.hasUnpublishedChanges ? (
                  <p className="text-primary mt-0.5 text-xs">Unpublished changes</p>
                ) : null}
              </div>
              <div className="border-border bg-muted/15 rounded-lg border px-3 py-3">
                <p className="text-text-3 text-xs font-medium">MCP</p>
                <p className="text-text-1 mt-1 text-2xl font-semibold tabular-nums">
                  {mcpServerCount}
                </p>
                <p className="text-text-3 mt-0.5 text-xs">servers in config</p>
              </div>
              <div className="border-border bg-muted/15 rounded-lg border px-3 py-3">
                <p className="text-text-3 text-xs font-medium">Git checkpoints</p>
                <p className="text-text-1 mt-1 text-sm font-medium leading-snug">
                  {gitStatus?.enabled ? (gitStatus.isRepo ? 'On' : 'No repo') : 'Off'}
                </p>
                {lastCheckpointMs ? (
                  <p className="text-text-3 mt-0.5 text-xs">
                    Last {formatShortTime(lastCheckpointMs)}
                  </p>
                ) : null}
              </div>
            </div>
          </section>
        )
      case 'apps':
        return (
          <section className={sectionCardClass()}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Calculator className="text-text-3 size-4" aria-hidden />
                <h3 className="text-text-1 text-sm font-semibold">Workspace apps</h3>
              </div>
              <Button type="button" variant="ghost" size="sm" className="text-text-2 h-8" asChild>
                <Link to="/dashboard" search={{ tab: 'apps' }}>
                  Open Apps tab
                  <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              </Button>
            </div>
            {!isTauriRuntime ? (
              <p className="text-text-3 text-sm">Apps are available in the desktop app.</p>
            ) : snapshot?.webappAppRoutes?.length ? (
              <ul className="flex flex-col gap-2">
                {snapshot.webappAppRoutes.map((r) => (
                  <li key={r.path}>
                    <button
                      type="button"
                      onClick={() => void openAppRoute(r.path)}
                      className="border-border bg-muted/20 hover:bg-muted/40 flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors"
                    >
                      <span className="text-text-1 font-medium">{r.label}</span>
                      <span className="text-text-3 font-mono text-xs">{r.path}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-text-3 text-sm">
                No sub-apps found in <code className="text-text-2 text-xs">app-routes.tsx</code> yet.
                Initialize the workspace webapp or publish to refresh the list.
              </p>
            )}
          </section>
        )
      case 'recent_files':
        return (
          <section className={sectionCardClass()}>
            <div className="mb-4 flex items-center gap-2">
              <FileText className="text-text-3 size-4" aria-hidden />
              <h3 className="text-text-1 text-sm font-semibold">Recent files</h3>
            </div>
            {!snapshot?.recentFiles?.length ? (
              <p className="text-text-3 text-sm">
                Files you attach, import, or save will appear here automatically.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {snapshot.recentFiles.slice(0, 12).map((f) => (
                  <li
                    key={f.relativePath}
                    className="text-text-2 flex items-center justify-between gap-2 text-sm"
                  >
                    <span className="min-w-0 truncate font-mono text-xs" title={f.relativePath}>
                      {f.label ?? f.relativePath}
                    </span>
                    <span className="text-text-3 shrink-0 text-xs">
                      {formatShortTime(f.lastAccessedAtMs)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )
      case 'insights':
        return (
          <section className={sectionCardClass()}>
            <div className="mb-4 flex items-center gap-2">
              <Sparkles className="text-text-3 size-4" aria-hidden />
              <h3 className="text-text-1 text-sm font-semibold">Insights</h3>
            </div>
            <ul className="text-text-2 space-y-2 text-sm leading-relaxed">
              {heuristicInsights.map((line, i) => (
                <li key={`h-${i}`} className="flex gap-2">
                  <span className="text-text-3 shrink-0">·</span>
                  <span>{line}</span>
                </li>
              ))}
              {(snapshot?.insightItems ?? []).slice(0, 6).map((it) => (
                <li key={it.id} className="flex gap-2">
                  <span className="text-text-3 shrink-0">·</span>
                  <span>{it.text}</span>
                </li>
              ))}
            </ul>
            {heuristicInsights.length === 0 &&
            (snapshot?.insightItems?.length ?? 0) === 0 ? (
              <p className="text-text-3 text-sm">
                Tips will show as you use chats, apps, and connections. Optional: add{' '}
                <code className="text-text-2 text-xs">.braian/insights.json</code> for custom notes.
              </p>
            ) : null}
          </section>
        )
      default:
        return null
    }
  }

  if (loadError) {
    return (
      <div className="text-text-3 flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-sm">
        <p>{loadError}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => void reload()}>
          Retry
        </Button>
      </div>
    )
  }

  if (!snapshot && isTauriRuntime) {
    return (
      <div className="text-text-3 flex flex-1 items-center justify-center p-8 text-sm">
        Loading overview…
      </div>
    )
  }

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="w-full min-w-0 px-4 pb-10 pt-1 md:px-6 md:pb-12">
        <div className="flex w-full min-w-0 flex-col gap-6">
          <WorkspaceFolderManagementPanel workspaceId={workspaceId} />
          {welcomeSections.map((s) => (
            <div key={s.id} className="w-full min-w-0">
              {renderSection(s)}
            </div>
          ))}
          {bodySections.length > 0 ? (
            <div
              className={cn(
                'grid w-full min-w-0 grid-flow-dense grid-cols-1 gap-6',
                'lg:grid-cols-2 2xl:grid-cols-3',
                'auto-rows-min items-stretch',
              )}
            >
              {bodySections.map((s) => (
                <div
                  key={s.id}
                  className={cn('min-w-0', hubGridSpanClass(s.type))}
                >
                  {renderSection(s)}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </ScrollArea>
  )
}
