import { Link, useNavigate } from '@tanstack/react-router'
import {
  ArrowRight,
  Brain,
  Calculator,
  FileText,
  LayoutGrid,
  MessageSquare,
  Sparkles,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { useWorkspace } from '@/components/app/workspace-context'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { workspaceMcpConfigGet } from '@/lib/connections-api'
import { loadHubRecentApps, touchHubRecentApp, type HubRecentAppEntry } from '@/lib/hub-recent-apps'
import {
  AGENTS_RELATIVE_PATH,
  MEMORY_INJECT_MAX_BYTES,
  MEMORY_RELATIVE_PATH,
  SEMANTIC_MEMORY_INDEX_RELATIVE_PATH,
} from '@/lib/memory/constants'
import {
  acceptMemorySuggestion,
  dismissMemorySuggestion,
  listPendingMemorySuggestions,
  type PendingMemorySuggestionRow,
} from '@/lib/memory/suggestion-queue'
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

const FULL_WIDTH_SECTION_TYPES = new Set<HubDashboardSection['type']>([
  'at_a_glance',
  'welcome',
  'memory_queue',
])

const DOC_PATH_RE = /\.(md|mdx|txt|mdc)$/i

function isDocumentPath(relativePath: string): boolean {
  const p = relativePath.replace(/\\/g, '/')
  if (DOC_PATH_RE.test(p)) return true
  return p.toLowerCase().includes('/docs/')
}

function sectionCardClass() {
  return 'border-border bg-card h-full rounded-xl border p-4 shadow-sm md:p-5'
}

function hubGridSpanClass(type: HubDashboardSection['type']): string {
  if (type === 'kpis') {
    return 'lg:col-span-2 2xl:col-span-3'
  }
  if (type === 'insights' || type === 'memory_queue') {
    return '2xl:col-span-3'
  }
  return ''
}

function memorySnippetFromText(text: string, maxLen: number): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  if (oneLine.length <= maxLen) return oneLine
  return `${oneLine.slice(0, maxLen - 1)}…`
}

function snippetFromIndexMarkdown(raw: string, maxLen: number): string | null {
  const lines = raw.split(/\r?\n/)
  const parts: string[] = []
  for (const line of lines) {
    const t = line.trim()
    if (!t) {
      if (parts.length) break
      continue
    }
    if (t.startsWith('#')) continue
    parts.push(t)
    if (parts.join(' ').length > maxLen * 2) break
  }
  const joined = parts.join(' ').trim()
  return joined ? memorySnippetFromText(joined, maxLen) : null
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
  const { setActiveWorkspaceId } = useWorkspace()
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
  const [indexSnippet, setIndexSnippet] = useState<string | null>(null)
  const [agentsFilePresent, setAgentsFilePresent] = useState(false)
  const [publishStatus, setPublishStatus] = useState<Awaited<
    ReturnType<typeof workspaceWebappPublishStatus>
  > | null>(null)
  const [gitStatus, setGitStatus] = useState<Awaited<
    ReturnType<typeof workspaceGitStatus>
  > | null>(null)
  const [lastCheckpointMs, setLastCheckpointMs] = useState<number | null>(null)
  const [mcpServerCount, setMcpServerCount] = useState<number>(0)
  const [recentApps, setRecentApps] = useState<HubRecentAppEntry[]>([])
  const [pendingSuggestions, setPendingSuggestions] = useState<
    PendingMemorySuggestionRow[]
  >([])
  const [busySuggestionPath, setBusySuggestionPath] = useState<string | null>(
    null,
  )

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
      setMemorySnippet(null)
      setIndexSnippet(null)
      setAgentsFilePresent(false)
      setRecentApps([])
      setPendingSuggestions([])
      return
    }
    setLoadError(null)
    try {
      const [snap, pub, gs, mcp, mem, idx, agentsProbe, sug, appsRecent] =
        await Promise.all([
          workspaceHubSnapshot(workspaceId),
          workspaceWebappPublishStatus(workspaceId),
          workspaceGitStatus(workspaceId),
          workspaceMcpConfigGet(workspaceId),
          workspaceReadTextFile(
            workspaceId,
            MEMORY_RELATIVE_PATH,
            MEMORY_INJECT_MAX_BYTES,
          ).catch(() => null),
          workspaceReadTextFile(
            workspaceId,
            SEMANTIC_MEMORY_INDEX_RELATIVE_PATH,
            8192,
          ).catch(() => null),
          workspaceReadTextFile(workspaceId, AGENTS_RELATIVE_PATH, 16).catch(
            () => null,
          ),
          listPendingMemorySuggestions(workspaceId),
          loadHubRecentApps(workspaceId),
        ])
      setSnapshot(snap)
      setPublishStatus(pub)
      setGitStatus(gs)
      setMcpServerCount(Object.keys(mcp.mcpServers ?? {}).length)
      setPendingSuggestions(sug)
      setRecentApps(appsRecent)

      if (mem?.text?.trim()) {
        setMemorySnippet(memorySnippetFromText(mem.text, 220))
      } else {
        setMemorySnippet(null)
      }
      if (idx?.text?.trim()) {
        setIndexSnippet(snippetFromIndexMarkdown(idx.text, 280))
      } else {
        setIndexSnippet(null)
      }
      setAgentsFilePresent(Boolean(agentsProbe?.text?.length))

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

  const topSections = useMemo(
    () => sections.filter((s) => FULL_WIDTH_SECTION_TYPES.has(s.type)),
    [sections],
  )

  const bodySections = useMemo(
    () => sections.filter((s) => !FULL_WIDTH_SECTION_TYPES.has(s.type)),
    [sections],
  )

  const sortedConversations = useMemo(() => {
    const list = [...conversations]
    list.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      if (a.unread !== b.unread) return a.unread ? -1 : 1
      return b.updatedAtMs - a.updatedAtMs
    })
    return list.slice(0, 8)
  }, [conversations])

  const unreadCount = useMemo(
    () => conversations.filter((c) => c.unread).length,
    [conversations],
  )

  const pendingSuggestionCount = pendingSuggestions.length

  const heuristicInsights = useMemo(() => {
    const lines: string[] = []
    if (unreadCount > 0) {
      lines.push(
        `You have ${unreadCount} conversation${unreadCount === 1 ? '' : 's'} with new activity.`,
      )
    }
    if (pendingSuggestionCount > 0) {
      lines.push(
        `${pendingSuggestionCount} structured memory suggestion${pendingSuggestionCount === 1 ? '' : 's'} pending review.`,
      )
    }
    if (publishStatus?.hasUnpublishedChanges) {
      lines.push('The workspace app has changes that are not published yet.')
    }
    if (gitStatus?.enabled && gitStatus.isRepo && gitStatus.dirty) {
      lines.push(
        'Working tree has uncommitted changes (relative to the last Git checkpoint).',
      )
    }
    if (mcpServerCount === 0) {
      lines.push(
        'No MCP connections configured — add servers in workspace settings if you use tools.',
      )
    } else {
      lines.push(
        `${mcpServerCount} MCP server${mcpServerCount === 1 ? '' : 's'} in this workspace’s config.`,
      )
    }
    if (gitStatus?.enabled && lastCheckpointMs) {
      lines.push(`Last Git checkpoint: ${formatShortTime(lastCheckpointMs)}.`)
    }
    if (!agentsFilePresent) {
      lines.push(
        'No AGENTS.md at the workspace root (optional file for agent instructions).',
      )
    }
    return lines
  }, [
    unreadCount,
    pendingSuggestionCount,
    publishStatus?.hasUnpublishedChanges,
    mcpServerCount,
    gitStatus?.enabled,
    gitStatus?.isRepo,
    gitStatus?.dirty,
    lastCheckpointMs,
    agentsFilePresent,
  ])

  const heroSubtitle = useMemo(() => {
    if (indexSnippet) return indexSnippet
    if (memorySnippet) return memorySnippet
    return `Context and preferences for ${workspaceName} show up here as you use memory and chats.`
  }, [indexSnippet, memorySnippet, workspaceName])

  const openAppRoute = useCallback(
    async (path: string, labelHint?: string | null) => {
      if (!isTauriRuntime) return
      try {
        await workspaceWebappPreviewPathSet({ workspaceId, path })
        await touchHubRecentApp(workspaceId, path, labelHint ?? null)
        void navigate({ to: '/dashboard', search: { tab: 'apps' }, replace: false })
      } catch (e) {
        console.error('[braian] preview path', e)
      }
    },
    [isTauriRuntime, navigate, workspaceId],
  )

  const onAcceptSuggestion = useCallback(
    async (relativePath: string) => {
      setBusySuggestionPath(relativePath)
      try {
        const r = await acceptMemorySuggestion(workspaceId, relativePath)
        if (!r.ok) {
          console.error('[braian] accept suggestion', r.error)
        }
      } finally {
        setBusySuggestionPath(null)
        void reload()
      }
    },
    [workspaceId, reload],
  )

  const onDismissSuggestion = useCallback(
    async (relativePath: string) => {
      setBusySuggestionPath(relativePath)
      try {
        const r = await dismissMemorySuggestion(workspaceId, relativePath)
        if (!r.ok) {
          console.error('[braian] dismiss suggestion', r.error)
        }
      } finally {
        setBusySuggestionPath(null)
        void reload()
      }
    },
    [workspaceId, reload],
  )

  const renderGlanceSection = () => (
    <section className={sectionCardClass()}>
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 space-y-2">
          <p className="text-text-3 text-xs font-semibold tracking-widest uppercase">
            Workspace
          </p>
          <h2 className="text-text-1 text-xl font-semibold tracking-tight md:text-2xl">
            {workspaceName}
          </h2>
          <p className="text-text-2 max-w-3xl text-sm leading-relaxed lg:max-w-none lg:text-pretty">
            {heroSubtitle}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={() => {
              setActiveWorkspaceId(workspaceId)
              void navigate({ to: '/chat/new' })
            }}
          >
            New agent
          </Button>
        </div>
      </div>
    </section>
  )

  const renderSection = (s: HubDashboardSection) => {
    switch (s.type) {
      case 'at_a_glance':
      case 'welcome':
        return renderGlanceSection()
      case 'memory_queue':
        return (
          <section className={sectionCardClass()}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Brain className="text-text-3 size-4" aria-hidden />
                <h3 className="text-text-1 text-sm font-semibold">
                  Memory suggestions
                </h3>
              </div>
              <Button type="button" variant="ghost" size="sm" className="text-text-2 h-8" asChild>
                <Link to="/dashboard" search={{ tab: 'memory' }}>
                  Open Memory
                  <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              </Button>
            </div>
            {!isTauriRuntime ? (
              <p className="text-text-3 text-sm">
                Pending memory reviews are available in the desktop app.
              </p>
            ) : pendingSuggestions.length === 0 ? (
              <p className="text-text-3 text-sm">
                No pending suggestions. When the assistant proposes new structured memory, you can
                accept or dismiss it here or under Memory → Suggestions.
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {pendingSuggestions.slice(0, 5).map(({ relativePath, suggestion: su }) => (
                  <li
                    key={su.id}
                    className="border-border bg-muted/10 flex flex-col gap-2 rounded-lg border p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-text-2 font-medium">{su.proposedKind}</span>
                      <span className="text-text-3">
                        confidence {(su.confidence * 100).toFixed(0)}%
                      </span>
                    </div>
                    <p className="text-text-1 text-sm leading-relaxed">{su.candidateText}</p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        disabled={busySuggestionPath === relativePath}
                        onClick={() => void onAcceptSuggestion(relativePath)}
                      >
                        Accept
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busySuggestionPath === relativePath}
                        onClick={() => void onDismissSuggestion(relativePath)}
                      >
                        Dismiss
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {pendingSuggestions.length > 5 ? (
              <p className="text-text-3 mt-3 text-xs">
                +{pendingSuggestions.length - 5} more in Memory → Suggestions
              </p>
            ) : null}
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
                      className={cn(
                        'border-border bg-muted/20 hover:bg-muted/40 flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors',
                        c.unread && 'border-primary/30 bg-primary/5',
                      )}
                    >
                      <span className="text-text-1 min-w-0 truncate font-medium">
                        {c.pinned ? '· ' : ''}
                        {c.title}
                        {c.unread ? (
                          <span className="text-primary ml-1.5 text-xs font-normal">· New</span>
                        ) : null}
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
            <h3 className="text-text-1 mb-4 text-sm font-semibold">Status</h3>
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
                <p className="text-text-3 text-xs font-medium">Git</p>
                <p className="text-text-1 mt-1 text-sm font-medium leading-snug">
                  {gitStatus?.enabled
                    ? gitStatus.isRepo
                      ? gitStatus.dirty
                        ? 'Dirty'
                        : 'Clean'
                      : 'No repo'
                    : 'Off'}
                </p>
                {lastCheckpointMs ? (
                  <p className="text-text-3 mt-0.5 text-xs">
                    Last checkpoint {formatShortTime(lastCheckpointMs)}
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
                      onClick={() => void openAppRoute(r.path, r.label)}
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
      case 'recent_apps':
        return (
          <section className={sectionCardClass()}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <LayoutGrid className="text-text-3 size-4" aria-hidden />
                <h3 className="text-text-1 text-sm font-semibold">Recent in apps</h3>
              </div>
              <Button type="button" variant="ghost" size="sm" className="text-text-2 h-8" asChild>
                <Link to="/dashboard" search={{ tab: 'apps' }}>
                  Apps
                  <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              </Button>
            </div>
            {!isTauriRuntime ? (
              <p className="text-text-3 text-sm">Recent app routes are tracked in the desktop app.</p>
            ) : recentApps.length === 0 ? (
              <p className="text-text-3 text-sm">
                Open a workspace app from the list below or the Apps tab — routes you use will appear
                here.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {recentApps.slice(0, 10).map((e) => (
                  <li key={e.path}>
                    <button
                      type="button"
                      onClick={() => void openAppRoute(e.path, e.label)}
                      className="border-border bg-muted/20 hover:bg-muted/40 flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors"
                    >
                      <span className="text-text-1 min-w-0 truncate font-medium">{e.label}</span>
                      <span className="text-text-3 shrink-0 font-mono text-xs">{e.path}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )
      case 'recent_documents': {
        const docs =
          snapshot?.recentFiles?.filter((f) => isDocumentPath(f.relativePath)) ?? []
        return (
          <section className={sectionCardClass()}>
            <div className="mb-4 flex items-center gap-2">
              <FileText className="text-text-3 size-4" aria-hidden />
              <h3 className="text-text-1 text-sm font-semibold">Recent documents</h3>
            </div>
            {docs.length === 0 ? (
              <p className="text-text-3 text-sm">
                Markdown and text files you open in this workspace appear here (see also the
                workspace file tree).
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {docs.slice(0, 12).map((f) => (
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
      }
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
            {heuristicInsights.length === 0 && (snapshot?.insightItems?.length ?? 0) === 0 ? (
              <p className="text-text-3 text-sm">
                Tips will show as you use chats, apps, and memory. Optional: add{' '}
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
        Loading dashboard…
      </div>
    )
  }

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="w-full min-w-0 px-4 pb-10 pt-1 md:px-6 md:pb-12">
        <div className="flex w-full min-w-0 flex-col gap-6">
          {topSections.map((s) => (
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
                <div key={s.id} className={cn('min-w-0', hubGridSpanClass(s.type))}>
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
