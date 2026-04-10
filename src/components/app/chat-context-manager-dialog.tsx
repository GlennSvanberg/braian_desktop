import {
  Braces,
  Check,
  ChevronDown,
  Copy,
  Loader2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  buildTanStackChatTurnArgs,
  tanStackTurnArgsToSnapshot,
  type SerializableModelRequestSnapshot,
} from '@/lib/ai/chat-turn-args'
import type { ModelContextSectionGroup } from '@/lib/ai/model-context-section-meta'
import { deriveSnapshotSummary, type SnapshotSummary, type SectionSummary, type ToolBucket } from '@/lib/ai/snapshot-summary'
import { getDocumentCanvasLivePayload } from '@/lib/ai/document-canvas-live'
import { resolveChatHistoryForModelTurn } from '@/lib/conversation/working-memory'
import {
  isNonWorkspaceScopedSessionId,
  isUserProfileSessionId,
} from '@/lib/chat-sessions/detached'
import { chatSessionKey } from '@/lib/chat-sessions/keys'
import type { ChatThreadState } from '@/lib/chat-sessions/types'
import { loadContextConversationsForModel } from '@/lib/context-conversations-for-ai'
import { loadContextFilesForModel } from '@/lib/context-files-for-ai'
import { cn } from '@/lib/utils'

const EMPTY_DRAFT_USER_LINE =
  '[Composer is empty — type a message to preview the outbound payload.]'

/* ------------------------------------------------------------------ */
/*  Small reusable pieces                                              */
/* ------------------------------------------------------------------ */

function SectionHeading({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h3
      className={cn(
        'mt-5 border-b border-accent-500/30 pb-1 text-xs font-semibold tracking-wide text-accent-600 uppercase first:mt-0 dark:text-accent-500',
        className,
      )}
    >
      {children}
    </h3>
  )
}

function Stat({ label, value, muted }: { label: string; value: ReactNode; muted?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-medium tracking-wide text-accent-600/70 uppercase dark:text-accent-500/70">
        {label}
      </span>
      <span className={cn('text-sm font-medium', muted ? 'text-text-3' : 'text-text-1')}>
        {value}
      </span>
    </div>
  )
}

function MonoBlock({ text, maxH }: { text: string; maxH?: string }) {
  return (
    <pre
      className={cn(
        'overflow-auto rounded-md border border-border border-l-[3px] border-l-accent-500 bg-accent-500/[0.04] p-2 text-[11px] leading-relaxed whitespace-pre-wrap break-words text-text-2 dark:bg-accent-500/[0.06]',
        maxH ?? 'max-h-[min(40vh,24rem)]',
      )}
      tabIndex={0}
    >
      {text}
    </pre>
  )
}

function charLabel(n: number): string {
  if (n > 10_000) return `${(n / 1000).toFixed(1)}k chars`
  return `${n.toLocaleString()} chars`
}

/* ------------------------------------------------------------------ */
/*  Summary cards                                                      */
/* ------------------------------------------------------------------ */

const GROUP_ORDER: ModelContextSectionGroup[] = [
  'Core',
  'Skills',
  'User',
  'Workspace',
  'This turn',
  'Profile',
]

function SummaryCards({ summary }: { summary: SnapshotSummary }) {
  return (
    <div className="flex flex-col gap-4">
      {/* Status row */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="border-accent-500/40 text-accent-700 dark:text-accent-500">
          {summary.mode}
        </Badge>
        <Badge variant="outline" className="border-accent-500/40 text-accent-700 dark:text-accent-500">
          {summary.provider} / {summary.modelId}
        </Badge>
        {summary.mockAi && (
          <Badge variant="secondary" className="bg-yellow-500/15 text-yellow-800 dark:text-yellow-400">
            mock AI
          </Badge>
        )}
        {summary.appBuilderActive && (
          <Badge variant="secondary" className="bg-blue-500/15 text-blue-800 dark:text-blue-400">
            app builder
          </Badge>
        )}
        {summary.mcpToolsPresent && (
          <Badge variant="secondary" className="bg-purple-500/15 text-purple-800 dark:text-purple-400">
            MCP
          </Badge>
        )}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border border-accent-500/20 bg-accent-500/[0.03] p-3 sm:grid-cols-4 dark:bg-accent-500/[0.05]">
        <Stat label="System chars" value={charLabel(summary.totalSystemChars)} />
        <Stat label="Messages" value={summary.totalMessageCount} />
        <Stat label="Tools" value={`${summary.eagerToolCount} eager, ${summary.lazyToolCount} lazy`} />
        <Stat
          label="Canvas"
          value={
            summary.canvasState === 'present'
              ? `rev ${summary.canvasRevision ?? '?'}`
              : summary.canvasState === 'empty'
                ? 'empty'
                : 'none'
          }
          muted={summary.canvasState === 'none'}
        />
        <Stat label="Attached files" value={summary.attachedFilesCount || 'none'} muted={summary.attachedFilesCount === 0} />
        <Stat label="Attached chats" value={summary.attachedChatsCount || 'none'} muted={summary.attachedChatsCount === 0} />
        <Stat label="Skills catalog" value={summary.skillCatalogPresent ? 'yes' : 'no'} muted={!summary.skillCatalogPresent} />
        <Stat label="Memory" value={summary.memoryPresent ? 'yes' : 'no'} muted={!summary.memoryPresent} />
        <Stat label="Reasoning" value={summary.reasoningMode} />
        {summary.totalTokensApprox != null ? (
          <Stat
            label="Total tokens (approx.)"
            value={`~${summary.totalTokensApprox.toLocaleString()}`}
          />
        ) : null}
        {summary.messagesTokensApprox != null ? (
          <Stat
            label="Message tokens (approx.)"
            value={`~${summary.messagesTokensApprox.toLocaleString()}`}
          />
        ) : null}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Collapsible section group                                          */
/* ------------------------------------------------------------------ */

function CollapsibleSystemSection({ section, snap }: { section: SectionSummary; snap: SerializableModelRequestSnapshot }) {
  const raw = snap.systemSections.find((s) => s.id === section.id)
  return (
    <Collapsible>
      <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent-500/10">
        <ChevronDown className="size-3.5 shrink-0 text-accent-600 transition-transform group-data-[state=closed]:-rotate-90 dark:text-accent-500" />
        <span className="min-w-0 flex-1 truncate font-medium text-text-1">{section.label}</span>
        <span className="shrink-0 text-[10px] tabular-nums text-text-3">
          {charLabel(section.charCount)}
          {section.tokenApprox != null ? ` · ~${section.tokenApprox.toLocaleString()} tok` : ''}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="px-2 pt-1 pb-2">
        {raw && <MonoBlock text={raw.text} />}
      </CollapsibleContent>
    </Collapsible>
  )
}

function SystemSectionsGrouped({ snap, summary }: { snap: SerializableModelRequestSnapshot; summary: SnapshotSummary }) {
  return (
    <div className="flex flex-col gap-3">
      {GROUP_ORDER.map((group) => {
        const sections = summary.sectionsByGroup[group]
        if (sections.length === 0) return null
        return (
          <div key={group}>
            <div className="mb-1 flex items-center gap-2">
              <span className="text-[10px] font-semibold tracking-widest text-accent-600/80 uppercase dark:text-accent-500/80">
                {group}
              </span>
              <span className="text-[10px] text-text-3">
                {sections.length} {sections.length === 1 ? 'section' : 'sections'}
              </span>
            </div>
            <div className="flex flex-col gap-0.5 rounded-lg border border-accent-500/15 bg-accent-500/[0.02] dark:bg-accent-500/[0.04]">
              {sections.map((s) => (
                <CollapsibleSystemSection key={s.id} section={s} snap={snap} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Messages                                                           */
/* ------------------------------------------------------------------ */

function MessagesList({ messages }: { messages: SerializableModelRequestSnapshot['messages'] }) {
  if (messages.length === 0) {
    return <p className="py-4 text-center text-xs text-text-3">No messages in history.</p>
  }
  return (
    <ol className="flex flex-col gap-1.5">
      {messages.map((m, i) => (
        <Collapsible key={`${m.role}-${i}`}>
          <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent-500/10">
            <ChevronDown className="size-3.5 shrink-0 text-accent-600 transition-transform group-data-[state=closed]:-rotate-90 dark:text-accent-500" />
            <Badge variant="outline" className="border-accent-500/30 px-1.5 py-0 text-[10px] font-semibold uppercase">
              {m.role}
            </Badge>
            <span className="min-w-0 flex-1 truncate text-text-3">
              {m.content.slice(0, 100).replace(/\s+/g, ' ')}
              {m.content.length > 100 ? '…' : ''}
            </span>
            <span className="shrink-0 text-[10px] tabular-nums text-text-3">{charLabel(m.content.length)}</span>
          </CollapsibleTrigger>
          <CollapsibleContent className="px-2 pt-1 pb-2">
            <MonoBlock text={m.content} />
          </CollapsibleContent>
        </Collapsible>
      ))}
    </ol>
  )
}

/* ------------------------------------------------------------------ */
/*  Tools                                                              */
/* ------------------------------------------------------------------ */

function ToolsList({ snap, buckets }: { snap: SerializableModelRequestSnapshot; buckets: ToolBucket[] }) {
  if (snap.tools.length === 0) {
    return <p className="py-4 text-center text-xs text-text-3">No tools available this turn.</p>
  }
  return (
    <div className="flex flex-col gap-3">
      {buckets.map((bucket) => (
        <div key={bucket.label}>
          <div className="mb-1 text-[10px] font-semibold tracking-widest text-accent-600/80 uppercase dark:text-accent-500/80">
            {bucket.label}
          </div>
          <div className="flex flex-col gap-0.5 rounded-lg border border-accent-500/15 bg-accent-500/[0.02] dark:bg-accent-500/[0.04]">
            {bucket.tools.map((t) => {
              const full = snap.tools.find((ft) => ft.name === t.name)
              return (
                <Collapsible key={t.name}>
                  <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent-500/10">
                    <ChevronDown className="size-3.5 shrink-0 text-accent-600 transition-transform group-data-[state=closed]:-rotate-90 dark:text-accent-500" />
                    <code className="min-w-0 flex-1 truncate font-mono text-xs font-medium text-text-1">{t.name}</code>
                    {t.lazy ? (
                      <Badge variant="secondary" className="bg-amber-500/15 text-amber-700 dark:text-amber-400 px-1.5 py-0 text-[10px]">lazy</Badge>
                    ) : (
                      <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 px-1.5 py-0 text-[10px]">eager</Badge>
                    )}
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-1.5 px-2 pt-1 pb-2 text-xs">
                    <p className="text-text-2 leading-relaxed">{t.description}</p>
                    {full?.inputJsonSchema != null && (
                      <Collapsible>
                        <CollapsibleTrigger className="cursor-pointer text-[11px] font-medium text-accent-600 hover:underline dark:text-accent-500">
                          Input schema
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <MonoBlock text={JSON.stringify(full.inputJsonSchema, null, 2)} maxH="max-h-[min(30vh,16rem)]" />
                        </CollapsibleContent>
                      </Collapsible>
                    )}
                  </CollapsibleContent>
                </Collapsible>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Main snapshot panel                                                 */
/* ------------------------------------------------------------------ */

function SnapshotPanel({
  snap,
  emptyLabel,
}: {
  snap: SerializableModelRequestSnapshot | null
  emptyLabel: string
}) {
  const [copied, setCopied] = useState(false)

  const copyJson = useCallback(() => {
    if (!snap) return
    void navigator.clipboard.writeText(JSON.stringify(snap, null, 2))
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }, [snap])

  const summary = useMemo<SnapshotSummary | null>(
    () => (snap ? deriveSnapshotSummary(snap) : null),
    [snap],
  )

  if (!snap || !summary) {
    return (
      <p className="py-6 text-center text-sm text-text-3">
        {emptyLabel}
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Copy button */}
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-text-3">
          Derived from the raw snapshot passed to{' '}
          <code className="rounded bg-accent-500/15 px-1 py-px font-mono text-accent-700 dark:text-accent-500">
            chat()
          </code>
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1 border-accent-500/40 text-xs text-accent-700 hover:border-accent-500 hover:bg-accent-500/10 dark:text-accent-500"
          onClick={copyJson}
        >
          {copied ? (
            <Check className="size-3.5" aria-hidden />
          ) : (
            <Copy className="size-3.5" aria-hidden />
          )}
          Copy JSON
        </Button>
      </div>

      {/* Summary cards */}
      <SummaryCards summary={summary} />

      {/* System prompts — grouped & collapsible */}
      <SectionHeading>System prompts</SectionHeading>
      <SystemSectionsGrouped snap={snap} summary={summary} />

      {/* Messages — collapsible */}
      <SectionHeading>Messages ({snap.messages.length})</SectionHeading>
      <MessagesList messages={snap.messages} />

      {/* Tools — bucketed & collapsible */}
      <SectionHeading>Tools ({snap.tools.length})</SectionHeading>
      <ToolsList snap={snap} buckets={summary.toolBuckets} />

      {/* Settings warnings */}
      {snap.settingsWarnings.length > 0 && (
        <>
          <SectionHeading>Settings warnings</SectionHeading>
          <ul className="list-inside list-disc rounded-md border border-accent-500/20 bg-accent-500/[0.04] p-3 text-xs text-text-2 dark:bg-accent-500/[0.06]">
            {snap.settingsWarnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Dialog                                                             */
/* ------------------------------------------------------------------ */

export type ChatContextManagerDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  conversationId: string | null
  thread: ChatThreadState
  isTauriRuntime: boolean
}

export function ChatContextManagerDialog({
  open,
  onOpenChange,
  workspaceId,
  conversationId,
  thread,
  isTauriRuntime,
}: ChatContextManagerDialogProps) {
  const [nextSnapshot, setNextSnapshot] =
    useState<SerializableModelRequestSnapshot | null>(null)
  const [nextError, setNextError] = useState<string | null>(null)
  const [nextLoading, setNextLoading] = useState(false)

  useEffect(() => {
    if (!open) {
      setNextSnapshot(null)
      setNextError(null)
      return
    }
    if (thread.generating) {
      setNextLoading(false)
      setNextError(null)
      return
    }

    let cancelled = false
    setNextLoading(true)
    setNextError(null)

    void (async () => {
      try {
        const ap = thread.artifactPayload
        const sessionKey = chatSessionKey(workspaceId, conversationId)
        const live = getDocumentCanvasLivePayload(sessionKey)
        const documentCanvasSnapshot =
          isUserProfileSessionId(workspaceId)
            ? null
            : ap?.kind === 'document'
              ? {
                  body: live?.body ?? ap.body,
                  ...(ap.title !== undefined && ap.title !== ''
                    ? { title: ap.title }
                    : {}),
                  revision: ap.canvasRevision ?? 0,
                }
              : null

        let contextFiles:
          | Awaited<ReturnType<typeof loadContextFilesForModel>>
          | undefined
        let contextPriorConversations:
          | Awaited<ReturnType<typeof loadContextConversationsForModel>>
          | undefined
        if (thread.contextFiles.length > 0) {
          if (isNonWorkspaceScopedSessionId(workspaceId)) {
            contextFiles = undefined
          } else if (!isTauriRuntime) {
            contextFiles = thread.contextFiles.map((f) => ({
              relativePath: f.relativePath,
              ...(f.displayName != null && f.displayName !== ''
                ? { displayName: f.displayName }
                : {}),
              text: '[File contents load in the desktop app only; this is a web preview.]',
              fileTruncated: false,
            }))
          } else {
            try {
              contextFiles = await loadContextFilesForModel(
                workspaceId,
                thread.contextFiles,
              )
            } catch (e) {
              console.error('[braian] context manager load files', e)
              contextFiles = undefined
            }
          }
        }

        if ((thread.contextConversations ?? []).length > 0) {
          if (isNonWorkspaceScopedSessionId(workspaceId)) {
            contextPriorConversations = undefined
          } else if (!isTauriRuntime) {
            contextPriorConversations = (thread.contextConversations ?? []).map(
              (c) => ({
                conversationId: c.conversationId,
                title: c.title?.trim() || c.conversationId,
                text: '[Prior conversation transcripts load in the desktop app only; this is a web preview.]',
                truncated: false,
              }),
            )
          } else {
            try {
              contextPriorConversations = await loadContextConversationsForModel(
                workspaceId,
                thread.contextConversations ?? [],
                conversationId,
              )
            } catch (e) {
              console.error('[braian] context manager load conversations', e)
              contextPriorConversations = undefined
            }
          }
        }

        const { priorMessages, workingMemory, settings: aiSettings } =
          await resolveChatHistoryForModelTurn({
            workspaceId,
            conversationId,
            prevMessages: thread.messages,
          })

        const draft = thread.draft.trim()
        const userText = draft.length > 0 ? draft : EMPTY_DRAFT_USER_LINE

        const activeMcpServers = (thread.activeMcpServers ?? [])
          .map((s) => s.trim())
          .filter((s) => s.length > 0)

        const args = await buildTanStackChatTurnArgs({
          userText,
          context: {
            workspaceId,
            conversationId,
            ...(isUserProfileSessionId(workspaceId)
              ? { turnKind: 'profile' as const }
              : {}),
            agentMode: thread.agentMode ?? 'document',
            documentCanvasSnapshot,
            ...(contextFiles != null && contextFiles.length > 0
              ? { contextFiles }
              : {}),
            ...(contextPriorConversations != null &&
            contextPriorConversations.length > 0
              ? { contextPriorConversations }
              : {}),
            ...(activeMcpServers.length > 0 ? { activeMcpServers } : {}),
            ...(workingMemory != null
              ? { conversationWorkingMemory: workingMemory }
              : {}),
          },
          priorMessages,
          settings: aiSettings,
          skipSettingsValidation: true,
          reasoningMode: thread.reasoningMode === 'thinking' ? 'thinking' : 'fast',
        })

        if (!cancelled) {
          setNextSnapshot(tanStackTurnArgsToSnapshot(args, userText))
        }
      } catch (e) {
        if (!cancelled) {
          setNextError(
            e instanceof Error ? e.message : 'Could not build preview.',
          )
        }
      } finally {
        if (!cancelled) setNextLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [
    open,
    workspaceId,
    conversationId,
    thread.messages,
    thread.draft,
    thread.agentMode,
    thread.reasoningMode,
    thread.artifactPayload,
    thread.contextFiles,
    thread.contextConversations,
    thread.activeMcpServers,
    thread.generating,
    isTauriRuntime,
  ])

  const lastSent = thread.lastModelRequestSnapshot
  const generating = thread.generating

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        className="flex h-[min(92vh,72rem)]! w-[min(96rem,calc(100vw-1rem))]! max-w-none! flex-col gap-0 overflow-hidden border-2 border-accent-500/55 bg-background p-0 shadow-lg shadow-accent-500/10 sm:max-w-none! dark:border-accent-500/50 dark:shadow-accent-500/15"
      >
        <DialogHeader className="shrink-0 border-b border-accent-500/25 bg-accent-500/[0.07] px-5 py-4 sm:px-8 dark:bg-accent-500/[0.1]">
          <DialogTitle className="text-accent-700 dark:text-accent-500">
            Model context
          </DialogTitle>
          <DialogDescription className="text-text-2">
            Inspect the full payload assembled for the AI on each turn.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          defaultValue="next"
          className="flex min-h-0 flex-1 flex-col bg-accent-500/[0.02] px-5 pb-5 sm:px-8 dark:bg-accent-500/[0.03]"
        >
          <TabsList
            variant="line"
            className="mb-3 w-full shrink-0 justify-start rounded-lg bg-accent-500/10 px-1 py-0.5 dark:bg-accent-500/15"
          >
            <TabsTrigger
              value="last"
              className="text-xs data-[state=active]:text-accent-700 data-[state=active]:after:bg-accent-500 sm:text-sm dark:data-[state=active]:text-accent-500"
            >
              Last sent
            </TabsTrigger>
            <TabsTrigger
              value="next"
              className="text-xs data-[state=active]:text-accent-700 data-[state=active]:after:bg-accent-500 sm:text-sm dark:data-[state=active]:text-accent-500"
            >
              Next preview
            </TabsTrigger>
          </TabsList>

          {generating ? (
            <p className="text-text-2 mb-2 shrink-0 rounded-md border border-accent-500/20 bg-accent-500/[0.06] px-2 py-1.5 text-xs dark:bg-accent-500/[0.08]">
              A reply is in progress. <strong className="text-accent-700 dark:text-accent-500">Last sent</strong>{' '}
              matches that request.{' '}
              <strong className="text-accent-700 dark:text-accent-500">Next preview</strong> is based on the current draft.
            </p>
          ) : null}

          <TabsContent
            value="last"
            className="mt-0 min-h-0 flex-1 overflow-hidden outline-none data-[state=inactive]:hidden"
          >
            <ScrollArea className="h-[min(calc(92vh-10rem),62rem)] pr-3">
              <SnapshotPanel
                snap={lastSent}
                emptyLabel="No turn has been sent yet in this thread."
              />
            </ScrollArea>
          </TabsContent>

          <TabsContent
            value="next"
            className="mt-0 min-h-0 flex-1 overflow-hidden outline-none data-[state=inactive]:hidden"
          >
            {nextLoading ? (
              <div className="flex h-[min(calc(92vh-10rem),62rem)] items-center justify-center gap-2 text-sm text-accent-700 dark:text-accent-500">
                <Loader2 className="size-4 animate-spin text-accent-600" aria-hidden />
                Building preview…
              </div>
            ) : nextError ? (
              <p className="text-destructive flex h-[min(calc(92vh-10rem),62rem)] items-center justify-center text-sm">
                {nextError}
              </p>
            ) : (
              <ScrollArea className="h-[min(calc(92vh-10rem),62rem)] pr-3">
                <SnapshotPanel snap={nextSnapshot} emptyLabel="Could not build preview." />
              </ScrollArea>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

export function ChatContextManagerTriggerButton({
  onClick,
}: {
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-8 gap-1.5 rounded-full border border-accent-500/20 bg-accent-500/5 px-3.5 text-[13px] text-accent-700 transition-colors hover:border-accent-500/40 hover:bg-accent-500/10 dark:text-accent-500"
      onClick={onClick}
    >
      <Braces className="size-3.5 shrink-0 opacity-70" aria-hidden />
      Context
    </Button>
  )
}
