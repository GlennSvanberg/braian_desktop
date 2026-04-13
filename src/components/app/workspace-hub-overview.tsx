import { Link, useNavigate } from '@tanstack/react-router'
import type { LucideIcon } from 'lucide-react'
import {
  Activity,
  ArrowRight,
  Bell,
  Brain,
  Calculator,
  FileText,
  GitBranch,
  Info,
  LayoutGrid,
  MessageSquare,
  Package,
  Pin,
  Plug,
  Sparkles,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { useWorkspace } from '@/components/app/workspace-context'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { workspaceMcpConfigGet } from '@/lib/connections-api'
import { loadHubRecentApps, touchHubRecentApp, type HubRecentAppEntry } from '@/lib/hub-recent-apps'
import { AGENTS_RELATIVE_PATH } from '@/lib/memory/constants'
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

/** Matches `DashboardTab` in workspace-dashboard (avoid circular import). */
type HubDashboardTab =
  | 'overview'
  | 'apps'
  | 'workspace-settings'
  | 'memory'

type Props = {
  workspaceId: string
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

function formatShortTime(ms: number): string {
  const d = Date.now() - ms
  if (d < 60_000) return 'Just now'
  if (d < 3600_000) return `${Math.floor(d / 60_000)}m ago`
  if (d < 86400_000) return `${Math.floor(d / 3600_000)}h ago`
  return new Date(ms).toLocaleDateString()
}

type HubSectionTint = 'accent' | 'info' | 'warning' | 'success'

function hubSectionTintClass(tint: HubSectionTint): string {
  if (tint === 'info') return 'bg-info/12 text-info'
  if (tint === 'warning') return 'bg-warning/12 text-warning'
  if (tint === 'success') return 'bg-success/12 text-success'
  return 'bg-attention-soft text-attention'
}

function HubSectionHeader({
  icon: Icon,
  title,
  tint = 'accent',
  right,
}: {
  icon: LucideIcon
  title: string
  tint?: HubSectionTint
  right?: ReactNode
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-3">
        <div
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-lg',
            hubSectionTintClass(tint),
          )}
        >
          <Icon className="size-[1.125rem]" aria-hidden />
        </div>
        <h3 className="text-text-1 text-sm font-semibold tracking-tight">{title}</h3>
      </div>
      {right}
    </div>
  )
}

type AttentionTone = 'attention' | 'warning' | 'info'

type AttentionDestination =
  | { type: 'dashboard'; tab: HubDashboardTab }
  | { type: 'chat'; conversationId: string }

type AttentionStripItem = {
  id: string
  label: string
  Icon: LucideIcon
  tone: AttentionTone
  to: AttentionDestination
}

function notificationChipClass(tone: AttentionTone): string {
  if (tone === 'warning') {
    return 'border-warning/35 bg-warning/10 text-text-1 hover:bg-warning/15'
  }
  if (tone === 'info') {
    return 'border-info/35 bg-info/10 text-text-1 hover:bg-info/15'
  }
  return 'border-[color:color-mix(in_srgb,var(--app-attention)_32%,transparent)] bg-attention-soft text-attention hover:brightness-110'
}

function HubNotificationChip({ item }: { item: AttentionStripItem }) {
  const Icon = item.Icon
  const chip = cn(
    'inline-flex max-w-[min(100%,17rem)] shrink-0 items-center gap-1 rounded-full border px-2 py-1.5 text-xs font-medium transition-colors',
    notificationChipClass(item.tone),
  )
  const inner = (
    <>
      <Icon className="size-3.5 shrink-0 opacity-90" aria-hidden />
      <span className="min-w-0 truncate">{item.label}</span>
      <ArrowRight className="text-text-3 size-3 shrink-0 opacity-80" aria-hidden />
    </>
  )
  if (item.to.type === 'chat') {
    return (
      <Link
        to="/chat/$conversationId"
        params={{ conversationId: item.to.conversationId }}
        className={chip}
      >
        {inner}
      </Link>
    )
  }
  return (
    <Link to="/dashboard" search={{ tab: item.to.tab }} className={chip}>
      {inner}
    </Link>
  )
}

function HubRowIcon({ icon: Icon, tint = 'accent' }: { icon: LucideIcon; tint?: HubSectionTint }) {
  return (
    <div
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-md',
        hubSectionTintClass(tint),
      )}
    >
      <Icon className="size-4" aria-hidden />
    </div>
  )
}

export function WorkspaceHubOverview({
  workspaceId,
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
      setAgentsFilePresent(false)
      setRecentApps([])
      setPendingSuggestions([])
      return
    }
    setLoadError(null)
    try {
      const [snap, pub, gs, mcp, agentsProbe, sug, appsRecent] =
        await Promise.all([
          workspaceHubSnapshot(workspaceId),
          workspaceWebappPublishStatus(workspaceId),
          workspaceGitStatus(workspaceId),
          workspaceMcpConfigGet(workspaceId),
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

  const attentionStripItems = useMemo((): AttentionStripItem[] => {
    const items: AttentionStripItem[] = []
    const firstUnread = sortedConversations.find((c) => c.unread)
    if (pendingSuggestionCount > 0) {
      items.push({
        id: 'memory-suggestions',
        label: `${pendingSuggestionCount} memory suggestion${pendingSuggestionCount === 1 ? '' : 's'} to review`,
        Icon: Brain,
        tone: 'warning',
        to: { type: 'dashboard', tab: 'memory' },
      })
    }
    if (unreadCount > 0) {
      items.push({
        id: 'unread',
        label: `${unreadCount} chat${unreadCount === 1 ? '' : 's'} with new activity`,
        Icon: MessageSquare,
        tone: 'attention',
        to: firstUnread
          ? { type: 'chat', conversationId: firstUnread.id }
          : { type: 'dashboard', tab: 'overview' },
      })
    }
    if (publishStatus?.hasUnpublishedChanges) {
      items.push({
        id: 'unpublished',
        label: 'App has unpublished changes',
        Icon: Package,
        tone: 'warning',
        to: { type: 'dashboard', tab: 'workspace-settings' },
      })
    }
    if (gitStatus?.enabled && gitStatus.isRepo && gitStatus.dirty) {
      items.push({
        id: 'git-dirty',
        label: 'Uncommitted changes since last checkpoint',
        Icon: GitBranch,
        tone: 'warning',
        to: { type: 'dashboard', tab: 'workspace-settings' },
      })
    }
    return items
  }, [
    sortedConversations,
    pendingSuggestionCount,
    unreadCount,
    publishStatus?.hasUnpublishedChanges,
    gitStatus?.enabled,
    gitStatus?.isRepo,
    gitStatus?.dirty,
  ])

  const fyiInsights = useMemo(() => {
    const lines: string[] = []
    if (mcpServerCount === 0) {
      lines.push(
        'No MCP connections configured — add servers in workspace settings if you use tools.',
      )
    } else {
      lines.push(
        `${mcpServerCount} MCP server${mcpServerCount === 1 ? '' : 's'} in this workspace’s config.`,
      )
    }
    if (!agentsFilePresent) {
      lines.push(
        'No AGENTS.md at the workspace root (optional file for agent instructions).',
      )
    }
    if (gitStatus?.enabled && lastCheckpointMs) {
      lines.push(`Last Git checkpoint: ${formatShortTime(lastCheckpointMs)}.`)
    }
    return lines
  }, [mcpServerCount, agentsFilePresent, gitStatus?.enabled, lastCheckpointMs])

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

  const renderNotificationsSection = () => {
    if (attentionStripItems.length === 0) return null
    return (
      <section className={sectionCardClass()}>
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-2"
          role="region"
          aria-label="Notifications"
        >
          <div className="flex shrink-0 items-center gap-2.5">
            <div
              className={cn(
                'flex size-9 shrink-0 items-center justify-center rounded-lg',
                hubSectionTintClass('accent'),
              )}
            >
              <Bell className="size-[1.125rem]" aria-hidden />
            </div>
            <h3 className="text-text-1 text-sm font-semibold tracking-tight">Notifications</h3>
          </div>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            {attentionStripItems.map((item) => (
              <HubNotificationChip key={item.id} item={item} />
            ))}
          </div>
        </div>
      </section>
    )
  }

  const renderSection = (s: HubDashboardSection) => {
    switch (s.type) {
      case 'at_a_glance':
      case 'welcome':
        return renderNotificationsSection()
      case 'memory_queue':
        return (
          <section className={sectionCardClass()}>
            <HubSectionHeader
              icon={Brain}
              title="Memory suggestions"
              tint="info"
              right={
                <Button type="button" variant="ghost" size="sm" className="text-text-2 h-8" asChild>
                  <Link to="/dashboard" search={{ tab: 'memory' }}>
                    Open Memory
                    <ArrowRight className="size-3.5" aria-hidden />
                  </Link>
                </Button>
              }
            />
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
            <HubSectionHeader
              icon={MessageSquare}
              title="Continue"
              tint="accent"
              right={
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
              }
            />
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
                      <span className="text-text-1 flex min-w-0 items-center gap-2.5">
                        <HubRowIcon
                          icon={c.pinned ? Pin : MessageSquare}
                          tint={c.pinned ? 'warning' : 'accent'}
                        />
                        <span className="min-w-0 truncate font-medium">
                          {c.title}
                          {c.unread ? (
                            <span className="text-primary ml-1.5 text-xs font-normal">· New</span>
                          ) : null}
                        </span>
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
            <HubSectionHeader icon={Activity} title="Status" tint="accent" />
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="border-border bg-muted/15 flex gap-2.5 rounded-lg border px-3 py-3">
                <HubRowIcon icon={MessageSquare} tint="accent" />
                <div className="min-w-0 flex-1">
                  <p className="text-text-3 text-xs font-medium">Chats</p>
                  <p className="text-text-1 mt-0.5 text-2xl font-semibold tabular-nums">
                    {conversations.length}
                  </p>
                  {unreadCount > 0 ? (
                    <p className="text-primary mt-0.5 text-xs font-medium">{unreadCount} unread</p>
                  ) : (
                    <p className="text-success mt-0.5 text-xs">All caught up</p>
                  )}
                </div>
              </div>
              <div
                className={cn(
                  'border-border bg-muted/15 flex gap-2.5 rounded-lg border px-3 py-3',
                  publishStatus?.hasUnpublishedChanges && 'border-warning/40 bg-warning/5',
                  publishStatus?.hasPublishedDist &&
                    !publishStatus?.hasUnpublishedChanges &&
                    'border-success/25 bg-success/5',
                )}
              >
                <HubRowIcon
                  icon={Package}
                  tint={
                    publishStatus?.hasUnpublishedChanges
                      ? 'warning'
                      : publishStatus?.hasPublishedDist
                        ? 'success'
                        : 'accent'
                  }
                />
                <div className="min-w-0 flex-1">
                  <p className="text-text-3 text-xs font-medium">Published app</p>
                  <p className="text-text-1 mt-0.5 text-sm font-semibold leading-snug">
                    {publishStatus?.hasPublishedDist ? 'Built' : 'Not built'}
                  </p>
                  {publishStatus?.hasUnpublishedChanges ? (
                    <p className="text-warning mt-0.5 text-xs font-medium">Unpublished changes</p>
                  ) : publishStatus?.hasPublishedDist ? (
                    <p className="text-success mt-0.5 text-xs">Published</p>
                  ) : null}
                </div>
              </div>
              <div className="border-border bg-muted/15 flex gap-2.5 rounded-lg border px-3 py-3">
                <HubRowIcon icon={Plug} tint="info" />
                <div className="min-w-0 flex-1">
                  <p className="text-text-3 text-xs font-medium">MCP</p>
                  <p className="text-text-1 mt-0.5 text-2xl font-semibold tabular-nums">
                    {mcpServerCount}
                  </p>
                  <p className="text-text-3 mt-0.5 text-xs">servers in config</p>
                </div>
              </div>
              <div
                className={cn(
                  'border-border bg-muted/15 flex gap-2.5 rounded-lg border px-3 py-3',
                  gitStatus?.enabled &&
                    gitStatus.isRepo &&
                    gitStatus.dirty &&
                    'border-warning/40 bg-warning/5',
                  gitStatus?.enabled &&
                    gitStatus.isRepo &&
                    !gitStatus.dirty &&
                    'border-success/25 bg-success/5',
                )}
              >
                <HubRowIcon
                  icon={GitBranch}
                  tint={
                    gitStatus?.enabled && gitStatus.isRepo && gitStatus.dirty
                      ? 'warning'
                      : gitStatus?.enabled && gitStatus.isRepo
                        ? 'success'
                        : 'accent'
                  }
                />
                <div className="min-w-0 flex-1">
                  <p className="text-text-3 text-xs font-medium">Git</p>
                  <p
                    className={cn(
                      'mt-0.5 text-sm font-semibold leading-snug',
                      gitStatus?.enabled && gitStatus.isRepo && gitStatus.dirty
                        ? 'text-warning'
                        : 'text-text-1',
                    )}
                  >
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
            </div>
          </section>
        )
      case 'apps':
        return (
          <section className={sectionCardClass()}>
            <HubSectionHeader
              icon={Calculator}
              title="Workspace apps"
              tint="accent"
              right={
                <Button type="button" variant="ghost" size="sm" className="text-text-2 h-8" asChild>
                  <Link to="/dashboard" search={{ tab: 'apps' }}>
                    Open Apps tab
                    <ArrowRight className="size-3.5" aria-hidden />
                  </Link>
                </Button>
              }
            />
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
                      <span className="text-text-1 flex min-w-0 items-center gap-2.5 font-medium">
                        <HubRowIcon icon={Calculator} tint="accent" />
                        <span className="min-w-0 truncate">{r.label}</span>
                      </span>
                      <span className="text-text-3 shrink-0 font-mono text-xs">{r.path}</span>
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
            <HubSectionHeader
              icon={LayoutGrid}
              title="Recent in apps"
              tint="accent"
              right={
                <Button type="button" variant="ghost" size="sm" className="text-text-2 h-8" asChild>
                  <Link to="/dashboard" search={{ tab: 'apps' }}>
                    Apps
                    <ArrowRight className="size-3.5" aria-hidden />
                  </Link>
                </Button>
              }
            />
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
                      <span className="text-text-1 flex min-w-0 items-center gap-2.5 font-medium">
                        <HubRowIcon icon={LayoutGrid} tint="info" />
                        <span className="min-w-0 truncate">{e.label}</span>
                      </span>
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
            <HubSectionHeader icon={FileText} title="Recent documents" tint="info" />
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
                    <span className="flex min-w-0 items-center gap-2.5">
                      <HubRowIcon icon={FileText} tint="info" />
                      <span className="min-w-0 truncate font-mono text-xs" title={f.relativePath}>
                        {f.label ?? f.relativePath}
                      </span>
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
            <HubSectionHeader icon={FileText} title="Recent files" tint="accent" />
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
                    <span className="flex min-w-0 items-center gap-2.5">
                      <HubRowIcon icon={FileText} tint="accent" />
                      <span className="min-w-0 truncate font-mono text-xs" title={f.relativePath}>
                        {f.label ?? f.relativePath}
                      </span>
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
            <HubSectionHeader icon={Sparkles} title="Insights" tint="accent" />
            <ul className="text-text-2 space-y-2.5 text-sm leading-relaxed">
              {fyiInsights.map((line, i) => (
                <li key={`fyi-${i}`} className="flex gap-2.5">
                  <span className="mt-0.5 shrink-0">
                    <Info className="text-info size-4" aria-hidden />
                  </span>
                  <span>{line}</span>
                </li>
              ))}
              {(snapshot?.insightItems ?? []).slice(0, 6).map((it) => (
                <li key={it.id} className="flex gap-2.5">
                  <span className="mt-0.5 shrink-0">
                    <Sparkles className="text-attention size-4" aria-hidden />
                  </span>
                  <span>{it.text}</span>
                </li>
              ))}
            </ul>
            {fyiInsights.length === 0 && (snapshot?.insightItems?.length ?? 0) === 0 ? (
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
          {topSections.map((s) => {
            const node = renderSection(s)
            if (node == null) return null
            return (
              <div key={s.id} className="w-full min-w-0">
                {node}
              </div>
            )
          })}
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
