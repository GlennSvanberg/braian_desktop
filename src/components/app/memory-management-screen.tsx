import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  Archive,
  CheckCircle2,
  ChevronDown,
  Copy,
  FolderOpen,
  Info,
  Loader2,
  RefreshCw,
  Search,
} from 'lucide-react'
import { revealItemInDir } from '@tauri-apps/plugin-opener'

import { ChatWorkspaceFileReference } from '@/components/app/chat-workspace-file-reference'
import { useWorkspace } from '@/components/app/workspace-context'
import { WorkspaceTextFileCanvas } from '@/components/workspace/workspace-text-file-canvas'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import {
  AGENTS_INJECT_MAX_BYTES,
  AGENTS_RELATIVE_PATH,
  SEMANTIC_MEMORY_ROOT,
} from '@/lib/memory/constants'
import {
  archiveMemoryEntry,
  markMemoryStale,
  updateMemoryEntryFields,
  validateMemoryEntry,
} from '@/lib/memory/memory-entry-operations'
import {
  acceptMemorySuggestion,
  dismissMemorySuggestion,
  listPendingMemorySuggestions,
} from '@/lib/memory/suggestion-queue'
import { matchesWorkspaceMemoryQuery } from '@/lib/memory/semantic-memory-search'
import type { SemanticMemoryRecordV1 } from '@/lib/memory/semantic-record'
import {
  buildSemanticMemorySystemText,
  loadAllSemanticRecords,
} from '@/lib/memory/semantic-store'
import { isTauri } from '@/lib/tauri-env'
import { joinRootRelative } from '@/lib/workspace-path-utils'
import { workspaceReadTextFile } from '@/lib/workspace-api'
import { cn } from '@/lib/utils'

export type MemoryManagementScreenProps = {
  workspaceId: string
  isTauriRuntime: boolean
}

const ALL_KINDS: SemanticMemoryRecordV1['kind'][] = [
  'fact',
  'decision',
  'preference',
  'episode',
  'pattern',
]

const ALL_STATUS: SemanticMemoryRecordV1['status'][] = [
  'active',
  'stale',
  'superseded',
  'archived',
]

const ALL_SCOPES: SemanticMemoryRecordV1['scope'][] = ['workspace', 'session']

function MemoryPageIntro() {
  const [open, setOpen] = useState(false)
  return (
    <header className="space-y-1">
      <div className="flex items-center gap-1">
        <h1 className="text-text-1 flex-1 text-lg font-semibold tracking-tight">
          Memory
        </h1>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-text-3 hover:text-text-2 size-8 shrink-0"
          onClick={() => setOpen(true)}
          aria-label="About the Memory page"
        >
          <Info className="size-4" aria-hidden />
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>About this page</DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[min(70vh,28rem)] pr-4">
            <div className="text-text-2 space-y-3 text-sm leading-relaxed">
              <p>
                This screen is the control room for what Braian loads from disk for{' '}
                <strong className="text-text-1">this workspace only</strong>: root
                instructions (<code className="text-text-1 text-xs">AGENTS.md</code>),
                structured memory JSON, and queued promotion suggestions.
              </p>
              <p>
                Changes you save here are written under the workspace folder. To inspect
                the exact system prompt for a given chat turn, use the{' '}
                <strong className="text-text-1">Context</strong> inspector while you are
                in a conversation.
              </p>
            </div>
          </ScrollArea>
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </header>
  )
}

function MemoryPanelHeader({
  title,
  subtitle,
  infoTitle,
  infoContent,
}: {
  title: string
  subtitle?: ReactNode
  infoTitle?: string
  infoContent: ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-0.5">
          <h2 className="text-text-1 text-base font-semibold tracking-tight">{title}</h2>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-text-3 hover:text-text-2 size-8 shrink-0"
            onClick={() => setOpen(true)}
            aria-label={`About ${title}`}
          >
            <Info className="size-4" aria-hidden />
          </Button>
        </div>
        {subtitle ? (
          <div className="text-text-3 mt-1 text-sm leading-relaxed">{subtitle}</div>
        ) : null}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{infoTitle ?? title}</DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[min(70vh,28rem)] pr-4">
            <div className="text-text-2 space-y-3 text-sm leading-relaxed">
              {infoContent}
            </div>
          </ScrollArea>
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function MemoryManagementScreen({
  workspaceId,
  isTauriRuntime,
}: MemoryManagementScreenProps) {
  const { workspaces } = useWorkspace()
  const workspace = useMemo(
    () => workspaces.find((w) => w.id === workspaceId) ?? null,
    [workspaces, workspaceId],
  )
  const rootPath = workspace?.rootPath ?? ''

  if (!isTauriRuntime || !isTauri()) {
    return (
      <div className="text-text-3 border-border mx-auto max-w-lg rounded-xl border p-6 text-sm">
        Memory management requires the Braian desktop app with a folder workspace.
      </div>
    )
  }

  return (
    <div className="bg-background flex min-h-0 flex-1 flex-col overflow-auto">
      <div className="mx-auto w-full min-w-0 max-w-none space-y-10 px-4 py-4 md:px-8 md:py-6 lg:px-10">
        <MemoryPageIntro />

        <div className="flex min-h-0 flex-col gap-10">
          <InstructionsTab workspaceId={workspaceId} />
          <WorkspaceMemorySection
            workspaceId={workspaceId}
            rootPath={rootPath}
          />
          <SuggestionsTab workspaceId={workspaceId} />
        </div>
      </div>
    </div>
  )
}

function Panel({
  title,
  subtitle,
  infoTitle,
  infoContent,
  children,
}: {
  title: string
  subtitle?: ReactNode
  infoTitle?: string
  infoContent: ReactNode
  children: ReactNode
}) {
  return (
    <div className="border-border space-y-3 rounded-xl border p-4 shadow-sm md:p-5">
      <MemoryPanelHeader
        title={title}
        subtitle={subtitle}
        infoTitle={infoTitle}
        infoContent={infoContent}
      />
      {children}
    </div>
  )
}

function InstructionsTab({ workspaceId }: { workspaceId: string }) {
  const [body, setBody] = useState('')
  const [truncated, setTruncated] = useState(false)
  const [fileOnDisk, setFileOnDisk] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await workspaceReadTextFile(
        workspaceId,
        AGENTS_RELATIVE_PATH,
        AGENTS_INJECT_MAX_BYTES,
      )
      setBody(r.text)
      setTruncated(r.truncated)
      setFileOnDisk(true)
    } catch {
      setBody('')
      setTruncated(false)
      setFileOnDisk(false)
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    void load()
  }, [load])

  const onCopyPath = () => {
    void navigator.clipboard.writeText(AGENTS_RELATIVE_PATH)
  }

  const onPersistSuccess = useCallback(() => {
    setFileOnDisk(true)
  }, [])

  return (
    <Panel
      title="AGENTS.md"
      infoContent={
        <>
          <p>
            <span className="text-text-1 font-medium">What it is.</span> A single
            markdown file at the workspace root (
            <code className="text-text-1 text-xs">{AGENTS_RELATIVE_PATH}</code>
            ) — the same &quot;agent instructions&quot; convention used elsewhere. Put
            durable guidance here: stack, style, product rules, and how you want the
            assistant to behave in this repo.
          </p>
          <p>
            <span className="text-text-1 font-medium">How Braian uses it.</span> When
            the file exists, a <strong className="text-text-1">size-capped</strong>{' '}
            excerpt is injected into the system prompt each chat turn (see Context
            inspector for the exact text). Braian does not silently rewrite this file.
          </p>
          <p>
            <span className="text-text-1 font-medium">How to edit.</span> Use the
            editor below (saves automatically shortly after you stop typing), or edit
            the file in any external editor and use <strong className="text-text-1">Reload</strong>{' '}
            if you change it on disk.
          </p>
        </>
      }
    >
      {loading ? (
        <p className="text-text-3 flex items-center gap-2 text-xs">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          Loading…
        </p>
      ) : (
        <>
          {!fileOnDisk ? (
            <p className="text-text-2 bg-muted/40 border-border rounded-md border px-3 py-2 text-sm">
              No <code className="text-text-1 text-xs">{AGENTS_RELATIVE_PATH}</code>{' '}
              on disk yet. Type below and pause — the file will be created at the
              workspace root on first save.
            </p>
          ) : null}
          <WorkspaceTextFileCanvas
            workspaceId={workspaceId}
            relativePath={AGENTS_RELATIVE_PATH}
            body={body}
            truncated={truncated}
            title={AGENTS_RELATIVE_PATH}
            onPersistSuccess={onPersistSuccess}
            className="min-h-[min(45vh,26rem)]"
          />
        </>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => void load()}>
          <RefreshCw className="size-3.5" aria-hidden />
          Reload
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCopyPath}>
          <Copy className="size-3.5" aria-hidden />
          Copy relative path
        </Button>
      </div>
    </Panel>
  )
}

function WorkspaceMemorySection({
  workspaceId,
  rootPath,
}: {
  workspaceId: string
  rootPath: string
}) {
  return <StructuredMemoryPanel workspaceId={workspaceId} rootPath={rootPath} />
}

function StructuredMemoryPanel({
  workspaceId,
  rootPath,
}: {
  workspaceId: string
  rootPath: string
}) {
  const [rows, setRows] = useState<
    { record: SemanticMemoryRecordV1; relativePath: string }[]
  >([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [kindFilter, setKindFilter] = useState<string>('')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [injectionPreview, setInjectionPreview] = useState('')
  const [selected, setSelected] = useState<{
    record: SemanticMemoryRecordV1
    relativePath: string
  } | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [all, inject] = await Promise.all([
        loadAllSemanticRecords(workspaceId),
        buildSemanticMemorySystemText(workspaceId),
      ])
      setRows(all)
      setInjectionPreview(inject)
      setSelected((prev) => {
        if (!prev) return null
        const found = all.find(
          (x) =>
            x.record.id === prev.record.id &&
            x.relativePath === prev.relativePath,
        )
        return found ?? null
      })
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const filtered = useMemo(() => {
    return rows.filter(({ record }) => {
      if (kindFilter && record.kind !== kindFilter) return false
      if (statusFilter && record.status !== statusFilter) return false
      const q = query.trim()
      if (!q) return true
      return matchesWorkspaceMemoryQuery(record, q)
    })
  }, [rows, query, kindFilter, statusFilter])

  const onRevealMemoryDir = () => {
    if (!rootPath) return
    const abs = joinRootRelative(rootPath, SEMANTIC_MEMORY_ROOT)
    void revealItemInDir(abs).catch((e) => console.error(e))
  }

  const runAction = async (
    fn: () => Promise<{ ok: true } | { ok: false; error: string }>,
  ) => {
    setBusy(true)
    try {
      const r = await fn()
      if (!r.ok) window.alert(r.error)
      else await refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Panel
        title="Structured workspace memory"
        infoContent={
          <>
            <p>
              <span className="text-text-1 font-medium">What it is.</span> One JSON
              file per fact under{' '}
              <code className="text-text-1 text-xs">{SEMANTIC_MEMORY_ROOT}</code>.
              Entries can come from the assistant (e.g.{' '}
              <code className="text-text-1 text-xs">add_workspace_memory</code>), from
              accepting a suggestion below, or from your edits here.
            </p>
            <p>
              <span className="text-text-1 font-medium">How Braian uses it.</span>{' '}
              Active entries are merged into the system prompt (within a token budget).
              Use <strong className="text-text-1">Injection preview</strong> to see
              roughly what the model receives (active entries, token-budgeted — same
              idea as chat context).
            </p>
            <p>
              <span className="text-text-1 font-medium">Lifecycle.</span> Mark entries
              stale, validate, or archive when they are outdated; search and filters help
              you find entries as the set grows.
            </p>
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[12rem] flex-1">
            <Search className="text-text-3 pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2" />
            <Input
              className="pl-8"
              placeholder="Search summary, text, tags, id…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search memory"
            />
          </div>
          <select
            className="border-border bg-background text-text-1 focus-visible:ring-ring min-h-9 rounded-md border px-2 py-1.5 text-sm focus-visible:ring-2 focus-visible:outline-none"
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value)}
            aria-label="Filter by kind"
          >
            <option value="">All kinds</option>
            {ALL_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <select
            className="border-border bg-background text-text-1 focus-visible:ring-ring min-h-9 rounded-md border px-2 py-1.5 text-sm focus-visible:ring-2 focus-visible:outline-none"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            {ALL_STATUS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
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
              <RefreshCw className="size-4" aria-hidden />
            )}
            Refresh
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onRevealMemoryDir}
            disabled={!rootPath}
          >
            <FolderOpen className="size-4" aria-hidden />
            Open folder
          </Button>
        </div>

        <Collapsible className="rounded-lg border border-border">
          <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium hover:bg-muted/50 [&[data-state=open]>svg]:rotate-180">
            <ChevronDown className="size-4 shrink-0 transition-transform" />
            Injection preview
          </CollapsibleTrigger>
          <CollapsibleContent className="px-3 pb-3">
            <pre className="text-text-2 max-h-48 overflow-auto rounded-md border border-border bg-muted/20 p-2 font-mono text-xs whitespace-pre-wrap">
              {injectionPreview.trim() || '_(no active structured memory)_'}
            </pre>
          </CollapsibleContent>
        </Collapsible>

        {loading ? (
          <p className="text-text-3 flex items-center gap-2 text-xs">
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            Loading entries…
          </p>
        ) : (
          <div className="grid min-h-[280px] gap-3 md:grid-cols-[1fr_1fr]">
            <ScrollArea className="rounded-md border border-border md:max-h-[min(60vh,32rem)]">
              <ul className="divide-border divide-y p-0">
                {filtered.length === 0 ? (
                  <li className="text-text-3 p-3 text-sm">No matching entries.</li>
                ) : (
                  filtered.map(({ record, relativePath }) => {
                    const active =
                      selected?.record.id === record.id &&
                      selected?.relativePath === relativePath
                    return (
                      <li key={`${relativePath}:${record.id}`}>
                        <button
                          type="button"
                          onClick={() => setSelected({ record, relativePath })}
                          className={cn(
                            'hover:bg-muted/50 w-full px-3 py-2.5 text-left text-sm transition-colors',
                            active && 'bg-accent/15',
                          )}
                        >
                          <div className="text-text-1 font-medium">
                            {record.summary || record.text.slice(0, 80)}
                          </div>
                          <div className="text-text-3 mt-0.5 text-xs">
                            <span className="text-text-2">{record.kind}</span> ·{' '}
                            {record.status} ·{' '}
                            <span className="font-mono">{record.id}</span>
                          </div>
                        </button>
                      </li>
                    )
                  })
                )}
              </ul>
            </ScrollArea>
            <div className="border-border space-y-3 rounded-md border p-3 md:max-h-[min(60vh,32rem)] md:overflow-auto">
              {!selected ? (
                <p className="text-text-3 text-sm">Select an entry to view details.</p>
              ) : (
                <>
                  <div className="space-y-1">
                    <p className="text-text-2 text-xs font-medium uppercase">
                      Provenance
                    </p>
                    {selected.record.sourceRefs.length === 0 ? (
                      <p className="text-text-3 text-xs">No source refs.</p>
                    ) : (
                      <ul className="text-text-2 space-y-2 text-xs">
                        {selected.record.sourceRefs.map((ref, i) => {
                          if (ref.type === 'file' && rootPath) {
                            return (
                              <li key={i}>
                                <ChatWorkspaceFileReference
                                  relativePath={ref.path}
                                  workspaceRootPath={rootPath}
                                  variant="inline"
                                />
                              </li>
                            )
                          }
                          if (ref.type === 'conversation') {
                            return (
                              <li key={i}>
                                Conversation:{' '}
                                <code className="text-[11px]">
                                  {ref.conversationId}
                                </code>
                              </li>
                            )
                          }
                          return (
                            <li key={i}>
                              Tool: {ref.toolName}
                              {ref.note ? ` — ${ref.note}` : ''}
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                  <div>
                    <p className="text-text-2 mb-1 text-xs font-medium uppercase">
                      Text
                    </p>
                    <p className="text-text-1 text-sm whitespace-pre-wrap">
                      {selected.record.text}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        setEditOpen(true)
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void runAction(() =>
                          markMemoryStale(workspaceId, {
                            kind: selected.record.kind,
                            entryId: selected.record.id,
                          }),
                        )
                      }
                    >
                      Mark stale
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void runAction(() =>
                          validateMemoryEntry(workspaceId, {
                            kind: selected.record.kind,
                            entryId: selected.record.id,
                          }),
                        )
                      }
                    >
                      <CheckCircle2 className="size-3.5" aria-hidden />
                      Validate
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void runAction(() =>
                          archiveMemoryEntry(workspaceId, {
                            kind: selected.record.kind,
                            entryId: selected.record.id,
                          }),
                        )
                      }
                    >
                      <Archive className="size-3.5" aria-hidden />
                      Archive
                    </Button>
                  </div>
                  <p className="text-text-3 font-mono text-[11px] break-all">
                    {selected.relativePath}
                  </p>
                </>
              )}
            </div>
          </div>
        )}
      </Panel>

      {selected ? (
        <EditMemoryEntryDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          workspaceId={workspaceId}
          record={selected.record}
          onSaved={async () => {
            setEditOpen(false)
            await refresh()
          }}
        />
      ) : null}
    </>
  )
}

function EditMemoryEntryDialog({
  open,
  onOpenChange,
  workspaceId,
  record,
  onSaved,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  workspaceId: string
  record: SemanticMemoryRecordV1
  onSaved: () => Promise<void>
}) {
  const [text, setText] = useState(record.text)
  const [summary, setSummary] = useState(record.summary)
  const [tagsRaw, setTagsRaw] = useState(record.tags.join(', '))
  const [scope, setScope] = useState<SemanticMemoryRecordV1['scope']>(record.scope)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setText(record.text)
      setSummary(record.summary)
      setTagsRaw(record.tags.join(', '))
      setScope(record.scope)
    }
  }, [open, record])

  const onSave = async () => {
    const tags = tagsRaw
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    setSaving(true)
    try {
      const r = await updateMemoryEntryFields(
        workspaceId,
        { kind: record.kind, entryId: record.id },
        { text, summary, tags, scope },
      )
      if (!r.ok) {
        window.alert(r.error)
        return
      }
      await onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit memory entry</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <label htmlFor="mem-summary" className="text-text-2 text-sm font-medium">
              Summary
            </label>
            <Input
              id="mem-summary"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="mem-text" className="text-text-2 text-sm font-medium">
              Text
            </label>
            <Textarea
              id="mem-text"
              className="min-h-[120px] font-mono text-sm"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="mem-tags" className="text-text-2 text-sm font-medium">
              Tags (comma-separated)
            </label>
            <Input
              id="mem-tags"
              value={tagsRaw}
              onChange={(e) => setTagsRaw(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="mem-scope" className="text-text-2 text-sm font-medium">
              Scope
            </label>
            <select
              id="mem-scope"
              className="border-border bg-background w-full min-h-9 rounded-md border px-2 py-1.5 text-sm"
              value={scope}
              onChange={(e) =>
                setScope(e.target.value as SemanticMemoryRecordV1['scope'])
              }
            >
              {ALL_SCOPES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" disabled={saving} onClick={() => void onSave()}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SuggestionsTab({ workspaceId }: { workspaceId: string }) {
  const [rows, setRows] = useState<
    Awaited<ReturnType<typeof listPendingMemorySuggestions>>
  >([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setRows(await listPendingMemorySuggestions(workspaceId))
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const act = async (
    rel: string,
    fn: () => Promise<{ ok: false; error: string } | { ok: true }>,
  ) => {
    setBusy(rel)
    try {
      const r = await fn()
      if (!r.ok) window.alert(r.error)
      await refresh()
    } finally {
      setBusy(null)
    }
  }

  return (
    <Panel
      title="Promotion suggestions"
      infoContent={
        <>
          <p>
            <span className="text-text-1 font-medium">What they are.</span> When
            automatic memory review runs (after idle time, if enabled in AI settings),
            Braian may queue short candidate facts here instead of writing memory
            immediately.
          </p>
          <p>
            <span className="text-text-1 font-medium">What you do.</span>{' '}
            <strong className="text-text-1">Accept</strong> turns a candidate into a
            real structured memory entry; <strong className="text-text-1">Dismiss</strong>{' '}
            drops it. Nothing is promoted until you choose.
          </p>
        </>
      }
    >
      <div className="mb-2 flex justify-end">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={loading}
          onClick={() => void refresh()}
        >
          {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          Refresh
        </Button>
      </div>
      {loading ? (
        <Loader2 className="text-text-3 size-6 animate-spin" />
      ) : rows.length === 0 ? (
        <p className="text-text-3 text-sm">No pending suggestions.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map(({ relativePath, suggestion: s }) => (
            <li
              key={s.id}
              className="border-border space-y-2 rounded-lg border p-3"
            >
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-text-2 font-medium">{s.proposedKind}</span>
                <span className="text-text-3">
                  confidence {(s.confidence * 100).toFixed(0)}%
                </span>
                <span className="text-text-3 font-mono">{s.id}</span>
              </div>
              <p className="text-text-1 text-sm">{s.candidateText}</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={busy === relativePath}
                  onClick={() =>
                    void act(relativePath, () =>
                      acceptMemorySuggestion(workspaceId, relativePath),
                    )
                  }
                >
                  Accept
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy === relativePath}
                  onClick={() =>
                    void act(relativePath, () =>
                      dismissMemorySuggestion(workspaceId, relativePath),
                    )
                  }
                >
                  Dismiss
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
