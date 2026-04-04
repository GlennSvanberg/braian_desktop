import {
  Check,
  Copy,
  CornerDownLeft,
  Loader2,
  Paperclip,
  Sparkles,
  Square,
  X,
} from 'lucide-react'
import { open } from '@tauri-apps/plugin-dialog'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import {
  assistantPlainTextForCopy,
  ChatAssistantMessageBody,
  ChatUserMessageBody,
} from '@/components/app/chat-message-body'
import { ArtifactPanel } from '@/components/app/artifact-panel'
import { WorkspaceFilesPanel } from '@/components/app/workspace-files-panel'
import { useWorkspace } from '@/components/app/workspace-context'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { useIsMobile } from '@/hooks/use-mobile'
import { chatSessionKey } from '@/lib/chat-sessions/keys'
import type { ChatThreadState } from '@/lib/chat-sessions/types'
import {
  replaceThread,
  seedCanvasPreviewIfEmpty,
  useChatThread,
  useChatThreadActions,
} from '@/lib/chat-sessions/store'
import {
  DEFAULT_CHAT_TITLE,
  deriveConversationTitle,
} from '@/lib/conversation-title'
import { getConversationById } from '@/lib/mock-workspace-data'
import {
  isPathUnderRoot,
  relativePathFromRoot,
} from '@/lib/workspace-path-utils'
import {
  buildConversationSavePayload,
  conversationSave,
  workspaceImportFile,
  type ConversationDto,
} from '@/lib/workspace-api'
import { cn } from '@/lib/utils'

function normalizeCanvasKind(
  s: string | undefined,
): 'document' | 'tabular' | 'visual' {
  if (s === 'tabular' || s === 'tabular-multi') return 'tabular'
  if (s === 'visual') return 'visual'
  return 'document'
}

type ChatWorkbenchProps = {
  /** Conversation id from the sidebar, or `null` for a fresh “new chat” session. */
  conversationId: string | null
  /** When set (saved chat from `.braian`), drives title and canvas kind for previews. */
  conversationMeta?: ConversationDto | null
  /** Hydrate store from disk (from route `conversation_open`). */
  initialThread?: ChatThreadState | null
}

export function ChatWorkbench({
  conversationId,
  conversationMeta,
  initialThread = null,
}: ChatWorkbenchProps) {
  const {
    activeWorkspaceId,
    activeWorkspace,
    refreshConversations,
    isTauriRuntime,
  } = useWorkspace()
  const lastSerializedRef = useRef<string | null>(null)
  const initialThreadRef = useRef(initialThread)
  initialThreadRef.current = initialThread
  const hydratedSessionKeyRef = useRef<string | null>(null)
  const sessionKey = chatSessionKey(activeWorkspaceId, conversationId)
  const thread = useChatThread(sessionKey)
  const {
    sendChatTurn,
    setChatDraft,
    patchDocumentArtifactBody,
    stopChatGeneration,
    addContextFileEntry,
    removeContextFileEntry,
  } = useChatThreadActions()

  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null)

  const saved = conversationId
    ? getConversationById(conversationId)
    : undefined
  const [conversationTitle, setConversationTitle] = useState(() =>
    conversationMeta?.title ?? saved?.title ?? DEFAULT_CHAT_TITLE,
  )
  const autoTitleAppliedRef = useRef<string | null>(null)
  const isNewChat = conversationId === null

  const metaForSave = useMemo(
    () =>
      conversationMeta != null
        ? { ...conversationMeta, title: conversationTitle }
        : null,
    [conversationMeta, conversationTitle],
  )

  useEffect(() => {
    autoTitleAppliedRef.current = null
  }, [conversationId])

  useEffect(() => {
    if (!conversationMeta) return
    setConversationTitle(conversationMeta.title)
  }, [conversationMeta?.id, conversationMeta?.title])

  useEffect(() => {
    if (!conversationId || !conversationMeta) return
    if (autoTitleAppliedRef.current === conversationId) return
    if (conversationTitle !== DEFAULT_CHAT_TITLE) return
    const firstUser = thread.messages.find(
      (m) => m.role === 'user' && m.content.trim().length > 0,
    )
    if (!firstUser) return
    setConversationTitle(deriveConversationTitle(firstUser.content))
    autoTitleAppliedRef.current = conversationId
  }, [
    conversationId,
    conversationMeta,
    conversationTitle,
    thread.messages,
  ])

  const isMobile = useIsMobile()
  const {
    messages,
    artifactOpen,
    artifactPayload,
    draft,
    generating,
    pendingUserMessages,
    contextFiles,
  } = thread

  const onAttachFiles = useCallback(async () => {
    if (!isTauriRuntime || !activeWorkspace?.rootPath) return
    const picked = await open({
      multiple: true,
      directory: false,
      title: 'Attach files to this chat',
      defaultPath: activeWorkspace.rootPath,
    })
    if (picked == null) return
    const paths = Array.isArray(picked) ? picked : [picked]
    for (const abs of paths) {
      try {
        if (isPathUnderRoot(abs, activeWorkspace.rootPath)) {
          const rel = relativePathFromRoot(abs, activeWorkspace.rootPath)
          const name = abs.replace(/[/\\]/g, '/').split('/').pop() ?? rel
          addContextFileEntry(sessionKey, {
            relativePath: rel,
            displayName: name,
          })
        } else {
          const { relativePath, displayName } = await workspaceImportFile(
            activeWorkspaceId,
            conversationId,
            abs,
          )
          addContextFileEntry(sessionKey, { relativePath, displayName })
        }
      } catch (e) {
        console.error('[braian] attach file', e)
      }
    }
  }, [
    activeWorkspace?.rootPath,
    activeWorkspaceId,
    addContextFileEntry,
    conversationId,
    isTauriRuntime,
    sessionKey,
  ])

  useLayoutEffect(() => {
    if (conversationId == null || !metaForSave) return
    const init = initialThreadRef.current
    if (!init) return
    if (hydratedSessionKeyRef.current === sessionKey) return
    hydratedSessionKeyRef.current = sessionKey
    replaceThread(sessionKey, init)
    if (isTauriRuntime) {
      lastSerializedRef.current = JSON.stringify(
        buildConversationSavePayload(
          { ...init, generating: false },
          metaForSave,
        ),
      )
    } else {
      lastSerializedRef.current = null
    }
  }, [conversationId, isTauriRuntime, metaForSave, sessionKey])

  useEffect(() => {
    seedCanvasPreviewIfEmpty(sessionKey, conversationId, {
      title: conversationTitle,
      canvasKind: conversationMeta
        ? normalizeCanvasKind(conversationMeta.canvasKind)
        : undefined,
    })
  }, [sessionKey, conversationId, conversationMeta, conversationTitle])

  useEffect(() => {
    if (
      conversationId == null ||
      !metaForSave ||
      !isTauriRuntime ||
      generating
    ) {
      return
    }
    const t = window.setTimeout(() => {
      const payload = buildConversationSavePayload(thread, metaForSave)
      const s = JSON.stringify(payload)
      if (s === lastSerializedRef.current) return
      void conversationSave(payload)
        .then(() => {
          lastSerializedRef.current = s
          return refreshConversations()
        })
        .catch((e) => console.error('[braian] conversation save failed', e))
    }, 400)
    return () => window.clearTimeout(t)
  }, [
    conversationId,
    generating,
    isTauriRuntime,
    metaForSave,
    refreshConversations,
    thread,
  ])

  const sendMessage = useCallback(() => {
    sendChatTurn(sessionKey, draft)
  }, [draft, sendChatTurn, sessionKey])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const copyMessageText = useCallback(async (messageId: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedMessageId(messageId)
      window.setTimeout(() => {
        setCopiedMessageId((id) => (id === messageId ? null : id))
      }, 1500)
    } catch (err) {
      console.error('[braian] copy failed', err)
    }
  }, [])

  const helperSubtitle = artifactOpen
    ? 'Workspace canvas is open · resize the split or keep typing below.'
    : 'Primary assistant replies stream here. Configure your API key under Settings. Dev mock: localStorage braian.mockAi = 1.'
  const filesPrivacyNote =
    contextFiles.length > 0
      ? 'Attached file contents are sent to your configured LLM provider when you send a message.'
      : null

  const queuedCount = pendingUserMessages.length

  const chatColumn = (
    <div
      className={cn(
        'bg-background flex h-full min-h-0 flex-col',
        !artifactOpen && 'flex-1',
        artifactOpen && !isMobile && 'md:rounded-l-xl',
        artifactOpen && isMobile && 'min-h-[min(100dvh,520px)]',
        !artifactOpen && 'md:rounded-xl md:border md:border-border',
      )}
    >
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-6 px-4 py-5 md:px-5">
          <div className="flex items-start gap-3">
            <div className="bg-accent-500/15 text-accent-600 border-accent-500/25 flex size-9 shrink-0 items-center justify-center rounded-full border">
              <Sparkles className="size-4" />
            </div>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-text-1 text-sm font-medium">
                  {conversationTitle}
                </p>
                {generating ? (
                  <span className="text-text-3 inline-flex items-center gap-1.5 text-xs">
                    <Loader2
                      className="size-3.5 shrink-0 animate-spin opacity-80"
                      aria-hidden
                    />
                    <span className="sr-only">Assistant is replying</span>
                    <span className="hidden sm:inline">Working…</span>
                  </span>
                ) : null}
                {generating ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-text-2 border-border h-7 gap-1.5 px-2 text-xs"
                    onClick={() => stopChatGeneration(sessionKey)}
                  >
                    <Square className="size-2.5 fill-current" aria-hidden />
                    Stop
                  </Button>
                ) : null}
              </div>
              <p className="text-text-3 mt-1 text-xs leading-relaxed">
                {helperSubtitle}
              </p>
              {contextFiles.length > 0 ? (
                <p className="text-text-3 mt-1 text-xs leading-relaxed">
                  {contextFiles.length} file
                  {contextFiles.length === 1 ? '' : 's'} in chat context
                  {filesPrivacyNote ? ` · ${filesPrivacyNote}` : ''}
                </p>
              ) : null}
            </div>
          </div>
          {messages.length === 0 ? (
            <div className="border-border bg-muted/25 text-text-3 rounded-xl border border-dashed px-4 py-8 text-center text-sm leading-relaxed">
              {isNewChat
                ? 'New conversation. Send a message to start; the workspace panel opens beside chat when you have a canvas.'
                : 'This thread starts empty. Send a message to chat with the assistant.'}
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              {messages.map((m) => {
                const copyText =
                  m.role === 'user'
                    ? m.content
                    : assistantPlainTextForCopy(m)
                const canCopy = copyText.length > 0
                const isUser = m.role === 'user'

                return (
                  <div
                    key={m.id}
                    className={cn(
                      'flex',
                      isUser ? 'justify-end' : 'justify-start',
                    )}
                  >
                    <div
                      className={cn(
                        'group/message relative max-w-[min(100%,42rem)]',
                      )}
                    >
                      {canCopy ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className={cn(
                            'text-text-3 hover:text-text-2 absolute top-1 right-1 z-10 size-7 shrink-0',
                            'opacity-70 md:opacity-0 md:transition-opacity',
                            'md:group-hover/message:opacity-100',
                            'focus-visible:opacity-100',
                          )}
                          aria-label="Copy message"
                          title="Copy message"
                          onClick={() => copyMessageText(m.id, copyText)}
                        >
                          {copiedMessageId === m.id ? (
                            <Check className="size-3.5 text-accent-600" />
                          ) : (
                            <Copy className="size-3.5" />
                          )}
                        </Button>
                      ) : null}
                      <div
                        className={cn(
                          'rounded-2xl border px-3.5 py-2.5 text-sm leading-relaxed shadow-sm',
                          isUser
                            ? 'bg-primary text-primary-foreground border-primary/20 rounded-tr-md pr-10'
                            : 'bg-card text-text-2 border-border rounded-tl-md pr-10',
                          m.role === 'assistant' &&
                            m.status === 'streaming' &&
                            !m.content &&
                            (!m.parts || m.parts.length === 0) &&
                            'text-text-3 italic',
                        )}
                      >
                        {isUser ? (
                          <ChatUserMessageBody content={m.content} />
                        ) : (
                          <ChatAssistantMessageBody message={m} />
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </ScrollArea>
      <div className="border-border bg-background/95 supports-backdrop-filter:bg-background/80 shrink-0 border-t p-3 backdrop-blur-md md:p-4">
        {isTauriRuntime && activeWorkspace?.rootPath ? (
          <WorkspaceFilesPanel
            className="mb-2"
            workspaceId={activeWorkspaceId}
            workspaceRootPath={activeWorkspace.rootPath}
            sessionKey={sessionKey}
          />
        ) : null}
        {contextFiles.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {contextFiles.map((f) => (
              <Badge
                key={f.relativePath}
                variant="secondary"
                className="text-text-2 border-border max-w-full gap-1 pr-0.5 font-normal"
                title={f.relativePath}
              >
                <span className="max-w-[14rem] truncate">
                  {f.displayName?.trim() ||
                    f.relativePath.split('/').pop() ||
                    f.relativePath}
                </span>
                <button
                  type="button"
                  className="hover:bg-muted rounded-full p-0.5"
                  aria-label={`Remove ${f.relativePath}`}
                  onClick={() =>
                    removeContextFileEntry(sessionKey, f.relativePath)
                  }
                >
                  <X className="size-3 opacity-70" aria-hidden />
                </button>
              </Badge>
            ))}
          </div>
        ) : null}
        <div className="bg-card border-border focus-within:ring-ring/40 relative rounded-xl border shadow-sm focus-within:ring-2">
          <Textarea
            placeholder="Message Braian…"
            value={draft}
            onChange={(e) => setChatDraft(sessionKey, e.target.value)}
            onKeyDown={onKeyDown}
            className="min-h-[88px] resize-none border-0 bg-transparent px-3.5 py-3 text-sm shadow-none focus-visible:ring-0"
          />
          <div className="flex items-center justify-between gap-2 px-2 pb-2">
            <div className="text-text-3 flex min-w-0 flex-wrap items-center gap-2 px-1.5 text-xs leading-relaxed">
              <p>Enter to send · Shift+Enter for newline</p>
              {isTauriRuntime && activeWorkspace?.rootPath ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-text-2 h-7 gap-1 px-2 text-xs"
                  onClick={() => void onAttachFiles()}
                >
                  <Paperclip className="size-3.5" aria-hidden />
                  Attach files
                </Button>
              ) : null}
              {queuedCount > 0 ? (
                <p className="text-accent-600 font-medium">
                  {queuedCount} message{queuedCount === 1 ? '' : 's'} queued
                </p>
              ) : null}
            </div>
            <Button
              type="button"
              size="sm"
              className="gap-1.5 shrink-0"
              onClick={sendMessage}
              disabled={!draft.trim()}
            >
              Send
              <CornerDownLeft className="size-3.5 opacity-80" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-0 md:gap-2 md:p-2">
      {!artifactOpen ? (
        <div className="flex min-h-0 flex-1 flex-col">{chatColumn}</div>
      ) : (
        <ResizablePanelGroup
          orientation={isMobile ? 'vertical' : 'horizontal'}
          className="min-h-0 flex-1 rounded-none md:rounded-xl md:border md:border-border"
        >
          <ResizablePanel
            defaultSize={isMobile ? 52 : 42}
            minSize={isMobile ? 30 : 28}
            className="min-h-0 min-w-0"
          >
            {chatColumn}
          </ResizablePanel>
          <ResizableHandle
            withHandle
            className={cn('bg-border', isMobile ? 'flex' : 'hidden md:flex')}
          />
          <ResizablePanel
            defaultSize={isMobile ? 48 : 58}
            minSize={isMobile ? 25 : 32}
            className="min-h-0 min-w-0"
          >
            <div
              className={cn(
                'h-full min-h-0 p-2 md:p-3',
                isMobile ? 'bg-muted/20 min-h-[280px]' : 'bg-muted/30 md:bg-transparent',
                !isMobile && 'md:rounded-r-xl',
              )}
            >
              <ArtifactPanel
                payload={artifactPayload}
                onDocumentBodyChange={(body) =>
                  patchDocumentArtifactBody(sessionKey, body)
                }
              />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
    </div>
  )
}
