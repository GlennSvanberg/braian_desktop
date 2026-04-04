import { Braces, Check, Copy, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
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
import { isDetachedWorkspaceSessionId } from '@/lib/chat-sessions/detached'
import { chatMessageContentForLlmHistory } from '@/lib/chat-sessions/store'
import type { ChatThreadState } from '@/lib/chat-sessions/types'
import { loadContextFilesForModel } from '@/lib/context-files-for-ai'
import { cn } from '@/lib/utils'

const EMPTY_DRAFT_USER_LINE =
  '[Composer is empty. Add text in the box below to preview the outbound user message.]'

type ChatContextManagerDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  conversationId: string | null
  thread: ChatThreadState
  /** Same flag as workspace context (desktop vs browser preview). */
  isTauriRuntime: boolean
}

function SectionTitle({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <h3
      className={cn(
        'mt-4 border-b border-accent-500/35 pb-1 text-sm font-semibold text-accent-600 first:mt-0 dark:text-accent-500',
        className,
      )}
    >
      {children}
    </h3>
  )
}

function MonospaceBlock({ text }: { text: string }) {
  return (
    <pre
      className="max-h-[min(45vh,28rem)] overflow-auto rounded-md border border-border border-l-[3px] border-l-accent-500 bg-accent-500/[0.06] p-2 text-xs whitespace-pre-wrap break-words text-text-2 sm:max-h-[min(50vh,32rem)] dark:bg-accent-500/[0.08]"
      tabIndex={0}
    >
      {text}
    </pre>
  )
}

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

  if (!snap) {
    return (
      <p className="text-text-3 py-6 text-center text-sm text-accent-700/90 dark:text-accent-500/90">
        {emptyLabel}
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-text-2 text-xs">
          Logical payload passed to TanStack{' '}
          <code className="rounded bg-accent-500/15 px-1 py-px font-mono text-accent-700 dark:text-accent-500">
            chat()
          </code>{' '}
          (provider adapters may merge system blocks).
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1 border-accent-500/45 text-xs text-accent-700 hover:border-accent-500 hover:bg-accent-500/10 dark:text-accent-500"
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

      <SectionTitle>Overview</SectionTitle>
      <dl className="grid gap-1 rounded-lg border border-accent-500/20 bg-accent-500/[0.04] p-3 text-xs text-text-2 sm:grid-cols-2 dark:bg-accent-500/[0.06]">
        <dt className="font-medium text-accent-700 dark:text-accent-500">Provider</dt>
        <dd className="text-text-1">{snap.provider}</dd>
        <dt className="font-medium text-accent-700 dark:text-accent-500">Model</dt>
        <dd className="text-text-1">{snap.modelId}</dd>
        <dt className="font-medium text-accent-700 dark:text-accent-500">Mock AI</dt>
        <dd className="text-text-1">{snap.mockAi ? 'Yes (dev)' : 'No'}</dd>
        <dt className="font-medium text-accent-700 dark:text-accent-500">Agent mode</dt>
        <dd className="text-text-1">{snap.isCodeMode ? 'code' : 'document'}</dd>
        <dt className="font-medium text-accent-700 dark:text-accent-500">User message</dt>
        <dd className="min-w-0 break-words text-text-1">{snap.userText}</dd>
      </dl>
      {snap.settingsWarnings.length > 0 ? (
        <div className="rounded-md border border-accent-500/25 bg-accent-500/[0.06] p-2 text-xs dark:bg-accent-500/[0.08]">
          <p className="font-medium text-accent-700 dark:text-accent-500">Settings</p>
          <ul className="text-text-2 mt-1 list-inside list-disc">
            {snap.settingsWarnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <SectionTitle>System prompts</SectionTitle>
      <div className="flex flex-col gap-3">
        {snap.systemSections.map((s) => (
          <div
            key={s.id}
            className="rounded-md border border-accent-500/25 border-l-[3px] border-l-accent-500 bg-accent-500/[0.04] p-3 dark:bg-accent-500/[0.06]"
          >
            <p className="text-sm font-medium text-accent-700 dark:text-accent-500">{s.label}</p>
            <p className="text-text-3 mt-0.5 font-mono text-[11px]">{s.source}</p>
            <MonospaceBlock text={s.text} />
          </div>
        ))}
      </div>

      <SectionTitle>Messages</SectionTitle>
      <ol className="flex flex-col gap-2 text-xs">
        {snap.messages.map((m, i) => (
          <li
            key={`${m.role}-${i}`}
            className="rounded-md border border-accent-500/25 border-l-[3px] border-l-accent-600/80 bg-accent-500/[0.03] p-2 dark:border-l-accent-500 dark:bg-accent-500/[0.05]"
          >
            <span className="font-medium tracking-wide text-accent-700 uppercase dark:text-accent-500">
              {m.role}
            </span>
            <MonospaceBlock text={m.content} />
          </li>
        ))}
      </ol>

      <SectionTitle>Tools</SectionTitle>
      <ul className="flex flex-col gap-2 text-xs">
        {snap.tools.map((t) => (
          <li
            key={t.name}
            className="space-y-1 rounded-md border border-accent-500/25 border-l-[3px] border-l-accent-500 bg-accent-500/[0.04] p-2 dark:bg-accent-500/[0.06]"
          >
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="font-mono font-medium text-accent-700 dark:text-accent-500">
                {t.name}
              </span>
              {t.lazy ? (
                <span className="rounded bg-accent-500/20 px-1.5 py-px text-[10px] font-medium text-accent-700 dark:text-accent-500">
                  lazy
                </span>
              ) : null}
            </div>
            <p className="text-text-3 font-mono text-[11px]">{t.sourceModule}</p>
            <p className="text-text-2 leading-relaxed">{t.description}</p>
            {t.inputJsonSchema != null ? (
              <details className="text-text-2">
                <summary className="cursor-pointer select-none text-xs font-medium text-accent-600 dark:text-accent-500">
                  Input JSON Schema
                </summary>
                <pre className="mt-1 max-h-[min(32vh,18rem)] overflow-auto rounded border border-accent-500/25 border-l-2 border-l-accent-500 bg-accent-500/[0.06] p-2 font-mono text-[11px] whitespace-pre-wrap break-words dark:bg-accent-500/[0.08]">
                  {JSON.stringify(t.inputJsonSchema, null, 2)}
                </pre>
              </details>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
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

    let cancelled = false
    setNextLoading(true)
    setNextError(null)

    void (async () => {
      try {
        const ap = thread.artifactPayload
        const documentCanvasSnapshot =
          ap?.kind === 'document'
            ? {
                body: ap.body,
                ...(ap.title !== undefined && ap.title !== ''
                  ? { title: ap.title }
                  : {}),
              }
            : null

        let contextFiles:
          | Awaited<ReturnType<typeof loadContextFilesForModel>>
          | undefined
        if (thread.contextFiles.length > 0) {
          if (isDetachedWorkspaceSessionId(workspaceId)) {
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

        const priorMessages = thread.messages.map((m) => ({
          role: m.role,
          content: chatMessageContentForLlmHistory(m),
        }))

        const draft = thread.draft.trim()
        const userText = draft.length > 0 ? draft : EMPTY_DRAFT_USER_LINE

        const args = await buildTanStackChatTurnArgs({
          userText,
          context: {
            workspaceId,
            conversationId,
            agentMode: thread.agentMode ?? 'document',
            documentCanvasSnapshot,
            ...(contextFiles != null && contextFiles.length > 0
              ? { contextFiles }
              : {}),
          },
          priorMessages,
          skipSettingsValidation: true,
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
    thread.artifactPayload,
    thread.contextFiles,
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
            What the app assembles for the AI on each turn: system prompts, chat history, tools, and
            settings (no API key).
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
              <strong className="text-accent-700 dark:text-accent-500">Next preview</strong> assumes you send
              the current composer text after this turn finishes (history includes the in-progress
              assistant text as it exists now).
            </p>
          ) : null}

          <TabsContent
            value="last"
            className="mt-0 min-h-0 flex-1 overflow-hidden outline-none data-[state=inactive]:hidden"
          >
            <ScrollArea className="h-[min(calc(92vh-10rem),62rem)] pr-3">
              <SnapshotPanel
                snap={lastSent}
                emptyLabel="No turn has been sent yet in this thread, or the snapshot could not be saved."
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
      variant="outline"
      size="sm"
      className="h-7 gap-1.5 border-accent-500/40 px-2 text-xs text-accent-700 hover:border-accent-500 hover:bg-accent-500/10 dark:text-accent-500"
      onClick={onClick}
    >
      <Braces className="size-3.5 shrink-0" aria-hidden />
      Context
    </Button>
  )
}
