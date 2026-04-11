import {
  Check,
  ChevronDown,
  Copy,
  CornerDownLeft,
  FileText,
  Info,
  Loader2,
  MessageSquare,
  Paperclip,
  PanelRightClose,
  PanelRightOpen,
  Plus,
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
import { useRouter } from '@tanstack/react-router'

import { ComposerContextShelf } from '@/components/app/composer-context-shelf'
import { ChatContextManagerDialog } from '@/components/app/chat-context-manager-dialog'
import {
  assistantPlainTextForCopy,
  ChatAssistantMessageBody,
  ChatUserMessageBody,
} from '@/components/app/chat-message-body'
import { ArtifactPanel } from '@/components/app/artifact-panel'
import { useOptionalShellHeaderToolbar } from '@/components/app/shell-header-toolbar'
import { useWorkspace } from '@/components/app/workspace-context'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { useIsMobile } from '@/hooks/use-mobile'
import {
  applyMentionPickToDraft,
  buildMentionPickList,
  getMentionQuery,
  type MentionPick,
} from '@/lib/chat-mentions'
import {
  isPersonalWorkspaceSessionId,
  PERSONAL_WORKSPACE_SESSION_ID,
  USER_PROFILE_WORKSPACE_SESSION_ID,
} from '@/lib/chat-sessions/detached'
import { chatSessionKey } from '@/lib/chat-sessions/keys'
import {
  artifactTabLabel,
  canvasLiveScopeKey,
  getActiveArtifactPayload,
  hasArtifactTabs,
} from '@/lib/chat-sessions/artifact-tabs'
import {
  PROFILE_CHAT_SESSION_KEY,
  getThreadSnapshot,
  removeArtifactTab,
  replaceThread,
  seedCanvasPreviewIfEmpty,
  setActiveArtifactTab,
  setArtifactPanelCollapsed,
  useChatThread,
  useChatThreadActions,
} from '@/lib/chat-sessions/store'
import { type ChatThreadState } from '@/lib/chat-sessions/types'
import { generateConversationTitleFromUserMessage } from '@/lib/ai/conversation-title-generate'
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
  workspaceMcpConfigGet,
} from '@/lib/connections-api'
import {
  defaultActiveSetFromDoc,
  disabledSetFromDoc,
} from '@/lib/mcp-config-types'
import {
  buildConversationSavePayload,
  conversationList,
  conversationMoveToWorkspace,
  conversationSave,
  workspaceImportFile,
  workspaceListAllFiles,
  type ConversationDto,
  type WorkspaceFileIndexEntry,
} from '@/lib/workspace-api'
import { registerWorkspaceFilePointerDropHandler } from '@/lib/workspace-file-pointer-dnd'
import { workspaceHubRecentFileTouch } from '@/lib/workspace-hub-api'
import { formatRelativeTime } from '@/lib/time'
import { cn } from '@/lib/utils'

function normalizeCanvasKind(
  s: string | undefined,
): 'document' | 'tabular' | 'visual' {
  if (s === 'tabular' || s === 'tabular-multi') return 'tabular'
  if (s === 'visual') return 'visual'
  return 'document'
}

type ChatSessionHeaderToolbarProps = {
  generating: boolean
  sessionKey: string
  stopChatGeneration: (key: string) => void
  isPersonalSimpleChat: boolean
  isTauriRuntime: boolean
  projectWorkspacesLength: number
  moveBusy: boolean
  onMoveOpen: () => void
}

/** Shared header toolbar control surface (height, radius, border). */
const headerToolbarBtnClass =
  'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-border/55 bg-muted/20 px-2.5 text-[13px] font-medium text-text-2 shadow-sm transition-colors hover:border-border hover:bg-muted/40 hover:text-text-1 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50'

type ComposerSessionToolsMenuProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenContext: () => void
  onAttachFiles: () => void
  activeAgentSegment: 'document' | 'code' | 'app'
  onSelectAgentSegment: (next: 'document' | 'code' | 'app') => void
  isTauriRuntime: boolean
  hasWorkspaceRoot: boolean
  isPersonalSimpleChat: boolean
  isProfileSession: boolean
  conversationId: string | null
}

function ComposerSessionToolsMenu({
  open,
  onOpenChange,
  onOpenContext,
  onAttachFiles,
  activeAgentSegment,
  onSelectAgentSegment,
  isTauriRuntime,
  hasWorkspaceRoot,
  isPersonalSimpleChat,
  isProfileSession,
  conversationId,
}: ComposerSessionToolsMenuProps) {
  const showAttach =
    isTauriRuntime && hasWorkspaceRoot && !isPersonalSimpleChat && !isProfileSession
  const showAgent =
    Boolean(conversationId) &&
    isTauriRuntime &&
    !isPersonalSimpleChat &&
    !isProfileSession

  const toolsRowBtnClass =
    'border-border/50 hover:bg-muted/80 focus-visible:ring-ring text-text-2 flex min-h-10 flex-1 min-w-0 items-center justify-center gap-1.5 rounded-lg border bg-transparent px-2 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2'

  const sectionLabelClass =
    'text-text-3 px-1 pb-1 text-[9px] font-semibold tracking-wide uppercase'

  return (
    <Popover modal open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-text-3 hover:text-text-2 hover:bg-muted/50 size-8 shrink-0 rounded-full transition-colors"
          aria-label="Chat tools: attach files, inspect context, agent mode"
          title="Chat tools"
        >
          <Plus className="size-4" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        className="border-border bg-popover text-popover-foreground w-[min(100vw-2rem,20rem)] max-h-[min(70vh,28rem)] overflow-y-auto p-1.5 text-xs shadow-md"
      >
        <div className={sectionLabelClass}>Tools</div>
        <div
          className={cn(
            'flex gap-1.5',
            !showAttach && 'flex-col',
          )}
        >
          {showAttach ? (
            <button
              type="button"
              className={toolsRowBtnClass}
              onClick={() => {
                onOpenChange(false)
                void onAttachFiles()
              }}
            >
              <Paperclip className="text-text-3 size-3.5 shrink-0 opacity-90" aria-hidden />
              <span className="text-text-1">Attach files</span>
            </button>
          ) : null}
          <button
            type="button"
            className={cn(toolsRowBtnClass, !showAttach && 'w-full flex-none')}
            title="Open the context inspector: pinned files and chats, outbound payload preview"
            onClick={() => {
              onOpenChange(false)
              onOpenContext()
            }}
          >
            <Info className="text-text-3 size-3.5 shrink-0 opacity-90" aria-hidden />
            <span className="text-text-1">Inspect context</span>
          </button>
        </div>
        {showAgent ? (
          <>
            <Separator className="my-1.5 bg-border/60" />
            <div className={sectionLabelClass}>Agent mode</div>
            <div
              className="border-border/60 bg-muted/15 grid grid-cols-3 divide-x divide-border/55 overflow-hidden rounded-md border"
              role="group"
              aria-label="Agent mode"
            >
              {(
                [
                  { id: 'document' as const, label: 'Document' },
                  { id: 'code' as const, label: 'Code' },
                  { id: 'app' as const, label: 'App' },
                ] as const
              ).map((seg) => (
                <button
                  key={seg.id}
                  type="button"
                  className={cn(
                    'focus-visible:ring-ring min-h-8 px-1 py-1.5 text-center text-xs font-medium transition-colors focus-visible:z-10 focus-visible:ring-2 focus-visible:outline-none sm:px-1.5',
                    activeAgentSegment === seg.id
                      ? 'bg-background text-text-1 shadow-sm'
                      : 'text-text-3 hover:bg-muted/30 hover:text-text-2 bg-transparent',
                  )}
                  aria-pressed={activeAgentSegment === seg.id}
                  title={
                    seg.id === 'document'
                      ? 'Document assistant: canvas, lazy file tools'
                      : seg.id === 'code'
                        ? 'Code assistant: eager read/write/run in workspace (no dashboard harness)'
                        : 'App agent: full code + dashboard tools; live preview in the side panel'
                  }
                  onClick={() => {
                    onSelectAgentSegment(seg.id)
                  }}
                >
                  {seg.label}
                </button>
              ))}
            </div>
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}

function ChatSessionHeaderToolbar({
  generating,
  sessionKey,
  stopChatGeneration,
  isPersonalSimpleChat,
  isTauriRuntime,
  projectWorkspacesLength,
  moveBusy,
  onMoveOpen,
}: ChatSessionHeaderToolbarProps) {
  const showWorkspaceMove =
    isPersonalSimpleChat &&
    isTauriRuntime &&
    projectWorkspacesLength > 0

  return (
    <div className="inline-flex w-max max-w-none items-center gap-1.5 pr-1">
      {showWorkspaceMove ? (
        <button
          type="button"
          className={headerToolbarBtnClass}
          disabled={generating || moveBusy}
          onClick={onMoveOpen}
        >
          Move to workspace
        </button>
      ) : null}
      {generating ? (
        <>
          <span
            className="text-text-3 inline-flex h-8 shrink-0 items-center gap-1.5 px-1 text-xs sm:px-2"
            aria-live="polite"
          >
            <Loader2
              className="size-3.5 shrink-0 animate-spin opacity-80"
              aria-hidden
            />
            <span className="sr-only">Assistant is replying</span>
            <span className="hidden sm:inline">Working…</span>
          </span>
          <button
            type="button"
            className={headerToolbarBtnClass}
            onClick={() => stopChatGeneration(sessionKey)}
          >
            <Square className="size-2.5 fill-current" aria-hidden />
            Stop
          </button>
        </>
      ) : null}
    </div>
  )
}

type ChatWorkbenchProps = {
  /** Conversation id from the sidebar, or `null` for a fresh “new chat” session. */
  conversationId: string | null
  /** When set (saved chat from `.braian`), drives title and canvas kind for previews. */
  conversationMeta?: ConversationDto | null
  /** Hydrate store from disk (from route `conversation_open`). */
  initialThread?: ChatThreadState | null
  /** Global profile coach (sidebar → You): dedicated session and tools only. */
  variant?: 'workspace' | 'profile'
}

export function ChatWorkbench({
  conversationId,
  conversationMeta,
  initialThread = null,
  variant = 'workspace',
}: ChatWorkbenchProps) {
  const isProfileSession = variant === 'profile'
  const isPersonalSimpleChat =
    !isProfileSession &&
    conversationMeta != null &&
    isPersonalWorkspaceSessionId(conversationMeta.workspaceId)
  const router = useRouter()
  const {
    activeWorkspaceId,
    activeWorkspace,
    refreshConversations,
    refreshConversationLists,
    projectWorkspaces,
    personalWorkspace,
    setActiveWorkspaceId,
    isTauriRuntime,
  } = useWorkspace()
  const lastSerializedRef = useRef<string | null>(null)
  const initialThreadRef = useRef(initialThread)
  initialThreadRef.current = initialThread
  /** Must match sidebar / disk: thread is owned by the conversation's workspace, not the UI-selected workspace. */
  const threadWorkspaceId = useMemo(() => {
    if (isProfileSession) return activeWorkspaceId
    if (conversationId != null && conversationMeta?.workspaceId) {
      return conversationMeta.workspaceId
    }
    return activeWorkspaceId
  }, [
    isProfileSession,
    conversationId,
    conversationMeta?.workspaceId,
    activeWorkspaceId,
  ])
  const initialThreadHydrationMark = useMemo(() => {
    const t = initialThread
    if (!t?.messages?.length) return '0'
    const m = t.messages
    return `${m.length}:${m[0]?.id ?? ''}:${m.at(-1)?.id ?? ''}`
  }, [initialThread])
  const hydrationMarkRef = useRef<string | null>(null)
  const sessionKey = useMemo(
    () =>
      isProfileSession
        ? PROFILE_CHAT_SESSION_KEY
        : chatSessionKey(threadWorkspaceId, conversationId),
    [isProfileSession, threadWorkspaceId, conversationId],
  )
  const thread = useChatThread(sessionKey)
  const {
    sendChatTurn,
    setChatDraft,
    patchDocumentArtifactBody,
    stopChatGeneration,
    setChatAgentMode,
    setChatReasoningMode,
    setChatActiveMcpServers,
    setArtifactPanelCollapsed: collapseArtifactPanel,
    setActiveArtifactTab,
    removeArtifactTab: closeArtifactTab,
    addContextFileEntry,
    removeContextFileEntry,
    addContextConversationEntry,
    removeContextConversationEntry,
  } = useChatThreadActions()

  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null)
  const [composerToolsOpen, setComposerToolsOpen] = useState(false)
  const [workspaceFileIndex, setWorkspaceFileIndex] = useState<
    WorkspaceFileIndexEntry[]
  >([])
  const [workspaceConversations, setWorkspaceConversations] = useState<
    ConversationDto[]
  >([])
  const [caretPos, setCaretPos] = useState(0)
  const [mentionHighlight, setMentionHighlight] = useState(0)
  const [mentionMenuSuppressed, setMentionMenuSuppressed] = useState(false)
  const [fileDragHighlight, setFileDragHighlight] = useState(false)
  const [contextManagerOpen, setContextManagerOpen] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)
  const [moveTargetWs, setMoveTargetWs] = useState('')
  const [moveBusy, setMoveBusy] = useState(false)
  const [configuredMcpServers, setConfiguredMcpServers] = useState<string[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const composerDropZoneRef = useRef<HTMLDivElement>(null)
  const dragHasFilesRef = useRef(false)

  const saved = conversationId
    ? getConversationById(conversationId)
    : undefined
  const [conversationTitle, setConversationTitle] = useState(() =>
    isProfileSession
      ? 'Your profile'
      : (conversationMeta?.title ??
        saved?.title ??
        DEFAULT_CHAT_TITLE),
  )
  const autoTitleAppliedRef = useRef<string | null>(null)
  const conversationTitleRef = useRef(conversationTitle)
  conversationTitleRef.current = conversationTitle
  const isNewChat = conversationId === null

  /** Stable while the assistant streams; avoids aborting title generation on every message chunk. */
  const firstUserMessageIdForAutoTitle = useMemo(() => {
    const m = thread.messages.find(
      (msg) => msg.role === 'user' && msg.content.trim().length > 0,
    )
    return m?.id ?? ''
  }, [thread.messages])

  useEffect(() => {
    if (!moveOpen || projectWorkspaces.length === 0) return
    setMoveTargetWs((prev) => {
      if (prev && projectWorkspaces.some((w) => w.id === prev)) return prev
      if (
        activeWorkspaceId &&
        projectWorkspaces.some((w) => w.id === activeWorkspaceId)
      ) {
        return activeWorkspaceId
      }
      return projectWorkspaces[0]?.id ?? ''
    })
  }, [moveOpen, projectWorkspaces, activeWorkspaceId])

  const metaForSave = useMemo(
    () =>
      conversationMeta != null
        ? { ...conversationMeta, title: conversationTitle }
        : null,
    [conversationMeta, conversationTitle],
  )

  useEffect(() => {
    if (isProfileSession) return
    autoTitleAppliedRef.current = null
  }, [conversationId, isProfileSession])

  useEffect(() => {
    if (!conversationMeta || isProfileSession) return
    setConversationTitle(conversationMeta.title)
  }, [conversationMeta?.id, conversationMeta?.title, isProfileSession])

  useEffect(() => {
    if (!conversationId || !conversationMeta || isProfileSession) return
    if (autoTitleAppliedRef.current === conversationId) return
    if (conversationTitleRef.current !== DEFAULT_CHAT_TITLE) return
    if (!firstUserMessageIdForAutoTitle) return
    const firstUser = thread.messages.find(
      (m) => m.id === firstUserMessageIdForAutoTitle,
    )
    if (!firstUser || firstUser.role !== 'user') return

    const heuristic = deriveConversationTitle(firstUser.content)
    setConversationTitle(heuristic)

    const mark = conversationId
    const ac = new AbortController()
    void generateConversationTitleFromUserMessage(firstUser.content, {
      signal: ac.signal,
    }).then((ai) => {
      if (ac.signal.aborted) return
      if (conversationTitleRef.current !== heuristic) return
      setConversationTitle(ai)
    }).finally(() => {
      if (!ac.signal.aborted) {
        autoTitleAppliedRef.current = mark
      }
    })

    return () => ac.abort()
  }, [
    conversationId,
    conversationMeta?.id,
    conversationMeta?.title,
    firstUserMessageIdForAutoTitle,
    isProfileSession,
  ])

  const isMobile = useIsMobile()
  const {
    messages,
    artifactTabs,
    activeArtifactTabId,
    artifactPanelCollapsed,
    draft,
    generating,
    pendingUserMessages,
    contextFiles,
    contextConversations,
    agentMode,
    reasoningMode,
  } = thread

  const artifactPayload = getActiveArtifactPayload(thread)
  const canvasLiveKey =
    isProfileSession || isPersonalSimpleChat || !activeArtifactTabId
      ? undefined
      : canvasLiveScopeKey(sessionKey, activeArtifactTabId)

  const canShowArtifactColumn =
    !isProfileSession &&
    (hasArtifactTabs(thread) || agentMode === 'app')

  const showArtifactPanel =
    canShowArtifactColumn && !artifactPanelCollapsed

  const showCollapsedPanelRestore =
    canShowArtifactColumn && artifactPanelCollapsed

  const chatScrollViewportRef = useRef<HTMLDivElement | null>(null)
  const chatPinSpacerRef = useRef<HTMLDivElement | null>(null)
  const prevGeneratingForPinScrollRef = useRef(false)
  /** User message id for the turn we are pinning (set when a streaming tail turn starts). */
  const pinTurnUserIdRef = useRef<string | null>(null)
  /**
   * Bottom slack must not shrink while the assistant grows; otherwise scrollHeight drops,
   * maxScroll clamps scrollTop down, and older messages re-enter the viewport.
   */
  const pinSlackMonotonicPxRef = useRef(0)
  const [chatViewportResizeTick, setChatViewportResizeTick] = useState(0)

  useLayoutEffect(() => {
    const viewport = chatScrollViewportRef.current
    if (!viewport || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() =>
      setChatViewportResizeTick((t) => t + 1),
    )
    ro.observe(viewport)
    return () => ro.disconnect()
  }, [sessionKey])

  useLayoutEffect(() => {
    const spacer = chatPinSpacerRef.current
    const wasGenerating = prevGeneratingForPinScrollRef.current

    const n = messages.length
    const last = n >= 1 ? messages[n - 1] : null
    const secondLast = n >= 2 ? messages[n - 2] : null
    const shouldPinTail =
      generating &&
      secondLast?.role === 'user' &&
      last?.role === 'assistant' &&
      last.status === 'streaming'

    if (shouldPinTail && (!wasGenerating || pinTurnUserIdRef.current == null)) {
      if (pinTurnUserIdRef.current !== secondLast!.id) {
        pinSlackMonotonicPxRef.current = 0
        if (chatPinSpacerRef.current) {
          chatPinSpacerRef.current.style.minHeight = ''
        }
      }
      pinTurnUserIdRef.current = secondLast!.id
    }

    if (!generating || !shouldPinTail) {
      // Do not clear the bottom spacer here: collapsing scrollHeight makes the browser
      // clamp scrollTop and the view jumps back to the top of the thread. The spacer is
      // cleared when the next user message starts a new pin (see block above).
      pinTurnUserIdRef.current = null
      pinSlackMonotonicPxRef.current = 0
      prevGeneratingForPinScrollRef.current = generating
      return
    }

    if (pinTurnUserIdRef.current !== secondLast!.id) {
      if (spacer) spacer.style.minHeight = ''
      pinSlackMonotonicPxRef.current = 0
      prevGeneratingForPinScrollRef.current = generating
      return
    }

    const userMessageId = secondLast!.id

    const applyPin = () => {
      const vp = chatScrollViewportRef.current
      const sp = chatPinSpacerRef.current
      const el = document.getElementById(`chat-message-${userMessageId}`)
      if (!vp || !sp || !el) return

      const topMarginPx = 16
      const desiredScrollTop = Math.max(
        0,
        vp.scrollTop +
          el.getBoundingClientRect().top -
          vp.getBoundingClientRect().top -
          topMarginPx,
      )
      const v = vp.clientHeight
      const spacerH = sp.offsetHeight
      const scrollH = vp.scrollHeight
      const contentExSpacer = scrollH - spacerH
      const slackNeeded = Math.max(
        0,
        Math.ceil(desiredScrollTop + v - contentExSpacer),
      )
      const slack = Math.max(slackNeeded, pinSlackMonotonicPxRef.current)
      pinSlackMonotonicPxRef.current = slack
      sp.style.minHeight = `${slack}px`
      void sp.offsetHeight

      const maxScroll = Math.max(0, vp.scrollHeight - vp.clientHeight)
      vp.scrollTop = Math.min(desiredScrollTop, maxScroll)
    }

    applyPin()
    requestAnimationFrame(applyPin)

    prevGeneratingForPinScrollRef.current = generating
  }, [generating, messages, chatViewportResizeTick])

  const mention = useMemo(
    () => getMentionQuery(draft, caretPos),
    [draft, caretPos],
  )
  const mentionOptions = useMemo(
    () =>
      mention
        ? buildMentionPickList(
            workspaceFileIndex,
            workspaceConversations,
            mention.query,
            conversationId,
          )
        : [],
    [
      mention,
      workspaceFileIndex,
      workspaceConversations,
      conversationId,
    ],
  )
  const showMentionList =
    mention != null &&
    !mentionMenuSuppressed &&
    !isPersonalSimpleChat &&
    !isProfileSession &&
    isTauriRuntime &&
    !!activeWorkspace?.rootPath

  const appendDraftMentions = useCallback(
    (tags: string[]) => {
      if (tags.length === 0) return
      const snap = getThreadSnapshot(sessionKey)
      const sep =
        snap.draft.length > 0 && !/\s$/.test(snap.draft) ? ' ' : ''
      setChatDraft(
        sessionKey,
        `${snap.draft}${sep}${tags.join(' ')} `,
      )
    },
    [sessionKey, setChatDraft],
  )

  const attachAbsolutePaths = useCallback(
    async (paths: string[]): Promise<string[]> => {
      const mentionTags: string[] = []
      if (
        isPersonalSimpleChat ||
        isProfileSession ||
        !isTauriRuntime ||
        !activeWorkspace?.rootPath
      ) {
        return mentionTags
      }
      for (const abs of paths) {
        try {
          if (isPathUnderRoot(abs, activeWorkspace.rootPath)) {
            const rel = relativePathFromRoot(abs, activeWorkspace.rootPath)
            const name =
              abs.replace(/[/\\]/g, '/').split('/').pop() ?? rel
            addContextFileEntry(sessionKey, {
              relativePath: rel,
              displayName: name,
            })
            void workspaceHubRecentFileTouch({
              workspaceId: activeWorkspaceId,
              relativePath: rel,
              label: name,
            })
            mentionTags.push(`@${name}`)
          } else {
            const { relativePath, displayName } = await workspaceImportFile(
              activeWorkspaceId,
              abs,
            )
            addContextFileEntry(sessionKey, { relativePath, displayName })
            void workspaceHubRecentFileTouch({
              workspaceId: activeWorkspaceId,
              relativePath,
              label: displayName,
            })
            mentionTags.push(`@${displayName}`)
          }
        } catch (e) {
          console.error('[braian] attach file', e)
        }
      }
      return mentionTags
    },
    [
      activeWorkspace?.rootPath,
      activeWorkspaceId,
      addContextFileEntry,
      isPersonalSimpleChat,
      isProfileSession,
      isTauriRuntime,
      sessionKey,
    ],
  )

  const onAttachFiles = useCallback(async () => {
    if (
      isPersonalSimpleChat ||
      isProfileSession ||
      !isTauriRuntime ||
      !activeWorkspace?.rootPath
    ) {
      return
    }
    const picked = await open({
      multiple: true,
      directory: false,
      title: 'Attach files to this chat',
      defaultPath: activeWorkspace.rootPath,
    })
    if (picked == null) return
    const paths = Array.isArray(picked) ? picked : [picked]
    await attachAbsolutePaths(paths)
  }, [
    activeWorkspace?.rootPath,
    attachAbsolutePaths,
    isPersonalSimpleChat,
    isProfileSession,
    isTauriRuntime,
  ])

  const onNativeFileDrop = useCallback(
    async (paths: string[]) => {
      if (isProfileSession) return
      const tags = await attachAbsolutePaths(paths)
      appendDraftMentions(tags)
    },
    [appendDraftMentions, attachAbsolutePaths, isProfileSession],
  )

  const applyInternalWorkspaceFileDrop = useCallback(
    (payload: { relativePath: string; displayName: string }) => {
      if (isProfileSession || isPersonalSimpleChat) return
      addContextFileEntry(sessionKey, {
        relativePath: payload.relativePath,
        displayName: payload.displayName,
      })
      void workspaceHubRecentFileTouch({
        workspaceId: activeWorkspaceId,
        relativePath: payload.relativePath,
        label: payload.displayName,
      })
      appendDraftMentions([`@${payload.displayName}`])
    },
    [
      activeWorkspaceId,
      addContextFileEntry,
      appendDraftMentions,
      isPersonalSimpleChat,
      isProfileSession,
      sessionKey,
    ],
  )

  const handleComposerHtmlDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      if (isProfileSession) return

      const dropped = Array.from(e.dataTransfer.files)
      const paths: string[] = []
      for (const f of dropped) {
        const path = (f as File & { path?: string }).path
        if (typeof path === 'string' && path.length > 0) {
          paths.push(path)
        }
      }
      if (paths.length > 0) void onNativeFileDrop(paths)
    },
    [isProfileSession, onNativeFileDrop],
  )

  useEffect(() => {
    return registerWorkspaceFilePointerDropHandler((payload) => {
      applyInternalWorkspaceFileDrop(payload)
    })
  }, [applyInternalWorkspaceFileDrop])

  useEffect(() => {
    setMentionHighlight(0)
  }, [mention?.start, mention?.query])

  useEffect(() => {
    if (mention == null) setMentionMenuSuppressed(false)
  }, [mention])

  useEffect(() => {
    setMentionMenuSuppressed(false)
  }, [mention?.start])

  useEffect(() => {
    if (
      !isTauriRuntime ||
      !threadWorkspaceId ||
      isPersonalSimpleChat ||
      isProfileSession
    ) {
      setWorkspaceFileIndex([])
      return
    }
    let cancelled = false
    void workspaceListAllFiles(threadWorkspaceId)
      .then((rows) => {
        if (!cancelled) setWorkspaceFileIndex(rows)
      })
      .catch((e) => console.error('[braian] workspace file index', e))
    return () => {
      cancelled = true
    }
  }, [isTauriRuntime, threadWorkspaceId, isPersonalSimpleChat, isProfileSession])

  useEffect(() => {
    if (
      !isTauriRuntime ||
      !threadWorkspaceId ||
      isPersonalSimpleChat ||
      isProfileSession
    ) {
      setConfiguredMcpServers([])
      return
    }
    let cancelled = false
    void workspaceMcpConfigGet(threadWorkspaceId)
      .then((doc) => {
        if (cancelled) return
        const disabled = disabledSetFromDoc(doc)
        const names = Object.keys(doc.mcpServers)
          .filter((n) => !disabled.has(n))
          .sort((a, b) => a.localeCompare(b))
        setConfiguredMcpServers(names)
        const active = (getThreadSnapshot(sessionKey).activeMcpServers ?? [])
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
        if (active.length === 0 && names.length > 0) {
          const defaults = Array.from(defaultActiveSetFromDoc(doc)).filter((n) =>
            names.includes(n),
          )
          const nextActive = defaults.length > 0 ? defaults : names
          setChatActiveMcpServers(sessionKey, nextActive)
          return
        }
        const next = active.filter((n) => names.includes(n))
        if (next.length !== active.length) {
          setChatActiveMcpServers(sessionKey, next)
        }
      })
      .catch((e) => {
        if (!cancelled) {
          console.error('[braian] mcp config load', e)
          setConfiguredMcpServers([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [
    isTauriRuntime,
    threadWorkspaceId,
    isPersonalSimpleChat,
    isProfileSession,
    sessionKey,
    setChatActiveMcpServers,
  ])

  useEffect(() => {
    if (
      !isTauriRuntime ||
      !threadWorkspaceId ||
      isPersonalSimpleChat ||
      isProfileSession
    ) {
      setWorkspaceConversations([])
      return
    }
    let cancelled = false
    void conversationList(threadWorkspaceId)
      .then((rows) => {
        if (!cancelled) setWorkspaceConversations(rows)
      })
      .catch((e) => console.error('[braian] conversation list for mentions', e))
    return () => {
      cancelled = true
    }
  }, [isTauriRuntime, threadWorkspaceId, isPersonalSimpleChat, isProfileSession])

  useEffect(() => {
    if (!isTauriRuntime) return
    let unlisten: (() => void) | undefined
    let alive = true
    void (async () => {
      const [{ getCurrentWebview }, { getCurrentWindow }, { PhysicalPosition }] =
        await Promise.all([
          import('@tauri-apps/api/webview'),
          import('@tauri-apps/api/window'),
          import('@tauri-apps/api/dpi'),
        ])
      if (!alive) return
      unlisten = await getCurrentWebview().onDragDropEvent(async (e) => {
        if (isProfileSession) {
          if (e.payload.type === 'leave') {
            dragHasFilesRef.current = false
            setFileDragHighlight(false)
          }
          return
        }
        const el = composerDropZoneRef.current
        if (!el) return
        const factor = await getCurrentWindow().scaleFactor()
        const posRaw = e.payload as { position?: { x: number; y: number } }
        if (e.payload.type === 'leave') {
          dragHasFilesRef.current = false
          setFileDragHighlight(false)
          return
        }
        if (e.payload.type === 'enter' && 'paths' in e.payload) {
          dragHasFilesRef.current = e.payload.paths.length > 0
        }
        const p = posRaw.position
        if (!p) return
        const logical = new PhysicalPosition(p.x, p.y).toLogical(factor)
        const r = el.getBoundingClientRect()
        const inside =
          logical.x >= r.left &&
          logical.x <= r.right &&
          logical.y >= r.top &&
          logical.y <= r.bottom
        if (e.payload.type === 'enter' || e.payload.type === 'over') {
          setFileDragHighlight(inside && dragHasFilesRef.current)
        }
        if (e.payload.type === 'drop') {
          dragHasFilesRef.current = false
          setFileDragHighlight(false)
          const paths =
            'paths' in e.payload && Array.isArray(e.payload.paths)
              ? e.payload.paths
              : []
          if (inside && paths.length > 0) {
            await onNativeFileDrop(paths)
          }
        }
      })
    })()
    return () => {
      alive = false
      unlisten?.()
    }
  }, [isProfileSession, isTauriRuntime, onNativeFileDrop])

  const pickMention = useCallback(
    (pick: MentionPick) => {
      const ta = textareaRef.current
      const caret = ta?.selectionStart ?? caretPos
      const m = getMentionQuery(draft, caret)
      if (!m) return
      const { nextDraft, nextCaret } = applyMentionPickToDraft(
        draft,
        caret,
        m.start,
        pick,
      )
      setChatDraft(sessionKey, nextDraft)
      if (pick.kind === 'file') {
        addContextFileEntry(sessionKey, {
          relativePath: pick.file.relativePath,
          displayName: pick.file.name,
        })
      } else {
        addContextConversationEntry(sessionKey, {
          conversationId: pick.conversation.id,
          title: pick.conversation.title,
        })
      }
      setMentionMenuSuppressed(true)
      requestAnimationFrame(() => {
        const t = textareaRef.current
        if (t) {
          t.focus()
          t.setSelectionRange(nextCaret, nextCaret)
          setCaretPos(nextCaret)
        }
      })
    },
    [
      addContextConversationEntry,
      addContextFileEntry,
      caretPos,
      draft,
      sessionKey,
      setChatDraft,
    ],
  )

  useLayoutEffect(() => {
    if (isProfileSession) return
    if (conversationId == null || !metaForSave) return
    const init = initialThreadRef.current
    if (!init) return
    const mark = `${sessionKey}|${initialThreadHydrationMark}`
    if (hydrationMarkRef.current === mark) return
    hydrationMarkRef.current = mark
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
  }, [
    conversationId,
    initialThreadHydrationMark,
    isProfileSession,
    isTauriRuntime,
    metaForSave,
    sessionKey,
  ])

  useEffect(() => {
    if (isProfileSession) return
    seedCanvasPreviewIfEmpty(sessionKey, conversationId, {
      title: conversationTitle,
      canvasKind: conversationMeta
        ? normalizeCanvasKind(conversationMeta.canvasKind)
        : undefined,
    })
  }, [
    sessionKey,
    conversationId,
    conversationMeta,
    conversationTitle,
    isProfileSession,
  ])

  useEffect(() => {
    if (
      isProfileSession ||
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
    isProfileSession,
    isTauriRuntime,
    metaForSave,
    refreshConversations,
    thread,
  ])

  const sendMessage = useCallback(() => {
    sendChatTurn(sessionKey, draft)
  }, [draft, sendChatTurn, sessionKey])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showMentionList && mentionOptions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionHighlight((i) => (i + 1) % mentionOptions.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionHighlight(
          (i) => (i - 1 + mentionOptions.length) % mentionOptions.length,
        )
        return
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        const pick = mentionOptions[mentionHighlight]
        if (pick) pickMention(pick)
        return
      }
      if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault()
        const pick = mentionOptions[mentionHighlight]
        if (pick) pickMention(pick)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setMentionMenuSuppressed(true)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const syncCaretFromTextarea = () => {
    const t = textareaRef.current
    if (t) setCaretPos(t.selectionStart)
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

  const runMoveToWorkspace = useCallback(
    async (targetWorkspaceId: string) => {
      if (
        !isPersonalSimpleChat ||
        !conversationId ||
        !conversationMeta ||
        !targetWorkspaceId ||
        moveBusy ||
        generating
      ) {
        return
      }
      setMoveBusy(true)
      try {
        if (metaForSave) {
          await conversationSave(
            buildConversationSavePayload(thread, metaForSave),
          )
        }
        await conversationMoveToWorkspace({
          id: conversationId,
          fromWorkspaceId: conversationMeta.workspaceId,
          toWorkspaceId: targetWorkspaceId,
        })
        await refreshConversationLists()
        setActiveWorkspaceId(targetWorkspaceId)
        setMoveOpen(false)
        await router.invalidate()
      } catch (e) {
        console.error(e)
        window.alert(e instanceof Error ? e.message : String(e))
      } finally {
        setMoveBusy(false)
      }
    },
    [
      isPersonalSimpleChat,
      conversationId,
      conversationMeta,
      moveBusy,
      generating,
      metaForSave,
      thread,
      refreshConversationLists,
      setActiveWorkspaceId,
      router,
    ],
  )

  const confirmMoveToWorkspace = useCallback(() => {
    void runMoveToWorkspace(moveTargetWs)
  }, [runMoveToWorkspace, moveTargetWs])

  const desktopToolsUnavailable =
    (agentMode === 'code' || agentMode === 'app') && !isTauriRuntime

  const queuedCount = pendingUserMessages.length

  const activeAgentSegment: 'document' | 'code' | 'app' =
    agentMode === 'app' ? 'app' : agentMode === 'code' ? 'code' : 'document'
  const showComposerMcpPills =
    Boolean(conversationId) &&
    isTauriRuntime &&
    !isPersonalSimpleChat &&
    !isProfileSession &&
    configuredMcpServers.length > 0

  const onSelectAgentSegment = useCallback(
    (next: 'document' | 'code' | 'app') => {
      setChatAgentMode(sessionKey, next)
    },
    [sessionKey, setChatAgentMode],
  )

  const shellHeaderToolbar = useOptionalShellHeaderToolbar()

  const openContextManager = useCallback(() => {
    setContextManagerOpen(true)
  }, [])

  const openMoveDialog = useCallback(() => {
    setMoveOpen(true)
  }, [])

  const onToggleMcpServer = useCallback(
    (name: string, enabled: boolean) => {
      const current = new Set(thread.activeMcpServers ?? [])
      if (enabled) current.add(name)
      else current.delete(name)
      const next = Array.from(current).filter((n) => configuredMcpServers.includes(n))
      setChatActiveMcpServers(sessionKey, next)
    },
    [configuredMcpServers, sessionKey, setChatActiveMcpServers, thread.activeMcpServers],
  )

  const sessionHeaderToolbarNode = useMemo(
    () => (
      <ChatSessionHeaderToolbar
        generating={generating}
        sessionKey={sessionKey}
        stopChatGeneration={stopChatGeneration}
        isPersonalSimpleChat={isPersonalSimpleChat}
        isTauriRuntime={isTauriRuntime}
        projectWorkspacesLength={projectWorkspaces.length}
        moveBusy={moveBusy}
        onMoveOpen={openMoveDialog}
      />
    ),
    [
      generating,
      sessionKey,
      stopChatGeneration,
      isPersonalSimpleChat,
      isTauriRuntime,
      projectWorkspaces.length,
      moveBusy,
      openMoveDialog,
    ],
  )

  useLayoutEffect(() => {
    if (!shellHeaderToolbar) return
    shellHeaderToolbar.setToolbar(sessionHeaderToolbarNode)
    return () => {
      shellHeaderToolbar.setToolbar(null)
    }
  }, [shellHeaderToolbar, sessionHeaderToolbarNode])

  const reasoningModeGroup = (
    <div
      className="border-border/55 bg-muted/25 grid h-8 shrink-0 grid-cols-2 divide-x divide-border/45 overflow-hidden rounded-md border"
      role="group"
      aria-label="Reasoning mode"
    >
      <button
        type="button"
        className={cn(
          'focus-visible:ring-ring flex h-full min-h-0 items-center justify-center px-2.5 text-center text-[13px] font-medium transition-colors focus-visible:z-10 focus-visible:ring-2 focus-visible:outline-none sm:px-3',
          reasoningMode === 'fast'
            ? 'bg-bg-2 text-text-1'
            : 'text-text-3 hover:bg-muted/45 hover:text-text-2 bg-transparent',
        )}
        aria-pressed={reasoningMode === 'fast'}
        title="Fast mode: Lower latency; minimal or no visible chain-of-thought"
        onClick={() => setChatReasoningMode(sessionKey, 'fast')}
      >
        Fast
      </button>
      <button
        type="button"
        className={cn(
          'focus-visible:ring-ring flex h-full min-h-0 items-center justify-center px-2.5 text-center text-[13px] font-medium transition-colors focus-visible:z-10 focus-visible:ring-2 focus-visible:outline-none sm:px-3',
          reasoningMode === 'thinking'
            ? 'bg-bg-2 text-text-1'
            : 'text-text-3 hover:bg-muted/45 hover:text-text-2 bg-transparent',
        )}
        aria-pressed={reasoningMode === 'thinking'}
        title="Thinking mode: More reasoning time; may show thinking when the model supports it"
        onClick={() => setChatReasoningMode(sessionKey, 'thinking')}
      >
        Thinking
      </button>
    </div>
  )

  const centeredEmptyComposer =
    !isProfileSession && messages.length === 0 && !showArtifactPanel

  const simpleChatsLabel = personalWorkspace?.name ?? 'Simple chats'
  const lockedWorkspaceLabel = isPersonalSimpleChat
    ? simpleChatsLabel
    : (projectWorkspaces.find((w) => w.id === conversationMeta?.workspaceId)
        ?.name ??
      conversationMeta?.workspaceId ??
      'Workspace')

  const workspaceTargetRow =
    conversationMeta && centeredEmptyComposer ? (
      <div className="mb-4 flex w-full justify-start">
        {isTauriRuntime &&
        isPersonalSimpleChat &&
        projectWorkspaces.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild disabled={moveBusy || generating}>
              <button
                type="button"
                className={cn(
                  'text-text-1 hover:text-text-2 inline-flex max-w-full items-center gap-1.5 rounded-md py-1 text-left text-sm font-medium',
                  'outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                  'disabled:pointer-events-none disabled:opacity-50',
                )}
                aria-label="Workspace for this chat"
                aria-haspopup="menu"
              >
                <span className="min-w-0 truncate">{lockedWorkspaceLabel}</span>
                <ChevronDown
                  className="text-text-2 size-4 shrink-0 opacity-90"
                  aria-hidden
                />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-48 max-w-[min(100vw-2rem,24rem)]">
              <DropdownMenuRadioGroup
                value={conversationMeta.workspaceId}
                onValueChange={(next) => {
                  if (moveBusy || generating || next === conversationMeta.workspaceId)
                    return
                  void runMoveToWorkspace(next)
                }}
              >
                <DropdownMenuRadioItem value={PERSONAL_WORKSPACE_SESSION_ID}>
                  {simpleChatsLabel}
                </DropdownMenuRadioItem>
                {projectWorkspaces.map((w) => (
                  <DropdownMenuRadioItem key={w.id} value={w.id}>
                    {w.name}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <div
            className="text-text-1 inline-flex max-w-full items-center gap-1.5 py-1 text-sm font-medium"
            aria-label="Workspace for this chat"
          >
            <span className="min-w-0 truncate">{lockedWorkspaceLabel}</span>
            <ChevronDown
              className="text-text-2 size-4 shrink-0 opacity-60"
              aria-hidden
            />
          </div>
        )}
      </div>
    ) : null

  const composerContextAttachmentsBlock =
    contextFiles.length === 0 && contextConversations.length === 0 ? null : (
      <div
        className="braian-context-attach-row flex flex-wrap gap-1.5"
        role="region"
        aria-label="Attached context"
      >
        {contextFiles.map((f) => (
          <div
            key={f.relativePath}
            className="braian-context-chip braian-context-chip--file"
            title={f.relativePath}
          >
            <FileText
              className="text-accent-600 size-3.5 shrink-0"
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate">
              {f.displayName?.trim() ||
                f.relativePath.split('/').pop() ||
                f.relativePath}
            </span>
            <button
              type="button"
              className="braian-context-chip-remove text-text-2"
              aria-label={`Remove file ${f.displayName?.trim() || f.relativePath}`}
              onClick={() =>
                removeContextFileEntry(sessionKey, f.relativePath)
              }
            >
              <X className="size-3" aria-hidden />
            </button>
          </div>
        ))}
        {contextConversations.map((c) => {
          const label = c.title?.trim() || c.conversationId
          return (
            <div
              key={c.conversationId}
              className="braian-context-chip braian-context-chip--chat"
              title={c.conversationId}
            >
              <MessageSquare
                className="text-accent-600 size-3.5 shrink-0 dark:text-accent-500"
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate">Chat: {label}</span>
              <button
                type="button"
                className="braian-context-chip-remove"
                aria-label={`Remove chat from context: ${label}`}
                onClick={() =>
                  removeContextConversationEntry(
                    sessionKey,
                    c.conversationId,
                  )
                }
              >
                <X className="size-3" aria-hidden />
              </button>
            </div>
          )
        })}
      </div>
    )

  const composerCardSection = (
    <div
      data-braian-file-drop-zone="1"
      className={cn(
        'bg-background border-border/40 focus-within:ring-ring/20 relative rounded-[20px] border shadow-sm focus-within:ring-2 transition-all duration-200',
        fileDragHighlight &&
          'ring-accent-500/50 border-accent-500/60 ring-2',
      )}
    >
      {showMentionList ? (
        <div
          className="border-border bg-popover text-popover-foreground absolute bottom-full left-2 right-2 z-20 mb-1 max-h-52 overflow-hidden rounded-lg border shadow-md"
          role="listbox"
          aria-label="Attach workspace file or conversation"
        >
          <ScrollArea className="max-h-52">
            <ul className="py-1">
              {mentionOptions.length === 0 ? (
                <li className="text-text-3 px-3 py-2 text-xs">
                  No matching files or chats
                </li>
              ) : (
                mentionOptions.map((opt, idx) => {
                  const showFilesHeader =
                    opt.kind === 'file' &&
                    (idx === 0 || mentionOptions[idx - 1]?.kind !== 'file')
                  const showChatsHeader =
                    opt.kind === 'chat' &&
                    (idx === 0 || mentionOptions[idx - 1]?.kind === 'file')
                  const rowKey =
                    opt.kind === 'file'
                      ? `f:${opt.file.relativePath}`
                      : `c:${opt.conversation.id}`
                  return (
                    <li key={rowKey} className="list-none">
                      {showFilesHeader ? (
                        <div className="text-text-3 px-3 pt-1 pb-0.5 text-[10px] font-semibold tracking-wide uppercase">
                          Files
                        </div>
                      ) : null}
                      {showChatsHeader ? (
                        <div className="text-accent-600 px-3 pt-1 pb-0.5 text-[10px] font-semibold tracking-wide uppercase dark:text-accent-500">
                          Chats
                        </div>
                      ) : null}
                      <button
                        type="button"
                        role="option"
                        aria-selected={idx === mentionHighlight}
                        className={cn(
                          'hover:bg-muted/80 flex w-full items-start gap-2 px-3 py-2 text-left text-xs',
                          idx === mentionHighlight && 'bg-muted',
                        )}
                        onMouseEnter={() => setMentionHighlight(idx)}
                        onMouseDown={(ev) => {
                          ev.preventDefault()
                          pickMention(opt)
                        }}
                      >
                        {opt.kind === 'file' ? (
                          <FileText
                            className="text-text-3 mt-0.5 size-3.5 shrink-0"
                            aria-hidden
                          />
                        ) : (
                          <MessageSquare
                            className="text-accent-600 mt-0.5 size-3.5 shrink-0 dark:text-accent-500"
                            aria-hidden
                          />
                        )}
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="text-text-1 font-medium">
                            {opt.kind === 'file'
                              ? opt.file.name
                              : opt.conversation.title}
                          </span>
                          <span className="text-text-3 truncate">
                            {opt.kind === 'file'
                              ? opt.file.relativePath
                              : `Conversation · ${opt.conversation.id.slice(0, 8)}…`}
                          </span>
                        </span>
                      </button>
                    </li>
                  )
                })
              )}
            </ul>
          </ScrollArea>
        </div>
      ) : null}
      {composerContextAttachmentsBlock}
      <div
        className={cn(
          'border-border/40 flex min-h-9 min-w-0 items-stretch border-b py-1',
          showComposerMcpPills
            ? 'gap-0 pr-2 pl-1'
            : 'justify-end gap-2 px-3 py-1.5',
        )}
      >
        {showComposerMcpPills ? (
          <div className="min-h-0 min-w-0 flex-1 self-stretch">
            <ComposerContextShelf
              servers={configuredMcpServers}
              activeServerNames={thread.activeMcpServers ?? []}
              onToggle={onToggleMcpServer}
            />
          </div>
        ) : null}
        <div
          className={cn(
            'flex shrink-0 items-center py-0.5',
            showComposerMcpPills
              ? 'border-border/45 border-l pl-2.5'
              : 'pr-0.5',
          )}
        >
          {reasoningModeGroup}
        </div>
      </div>
      <Textarea
        ref={textareaRef}
        placeholder="Message Braian…"
        value={draft}
        onChange={(e) => {
          setChatDraft(sessionKey, e.target.value)
          setCaretPos(e.target.selectionStart)
        }}
        onKeyDown={onKeyDown}
        onKeyUp={syncCaretFromTextarea}
        onClick={syncCaretFromTextarea}
        onSelect={syncCaretFromTextarea}
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }}
        onDrop={handleComposerHtmlDrop}
        className="min-h-[120px] resize-none border-0 bg-transparent px-4 pt-3 pb-12 text-sm shadow-none focus-visible:ring-0"
      />
      <div className="pointer-events-none absolute bottom-2 left-2 right-2 flex items-center justify-between">
        <div className="pointer-events-auto flex min-w-0 flex-wrap items-center gap-1.5 pl-1">
          <ComposerSessionToolsMenu
            open={composerToolsOpen}
            onOpenChange={setComposerToolsOpen}
            onOpenContext={openContextManager}
            onAttachFiles={onAttachFiles}
            activeAgentSegment={activeAgentSegment}
            onSelectAgentSegment={onSelectAgentSegment}
            isTauriRuntime={isTauriRuntime}
            hasWorkspaceRoot={Boolean(activeWorkspace?.rootPath)}
            isPersonalSimpleChat={isPersonalSimpleChat}
            isProfileSession={isProfileSession}
            conversationId={conversationId}
          />
          {queuedCount > 0 ? (
            <p className="text-accent-600 font-medium text-xs">
              {queuedCount} message{queuedCount === 1 ? '' : 's'} queued
            </p>
          ) : null}
        </div>
        <div className="pointer-events-auto pr-1">
          <Button
            type="button"
            size="icon"
            className={cn(
              'size-8 shrink-0 rounded-full transition-all duration-200',
              draft.trim()
                ? 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90'
                : 'bg-muted text-text-3 opacity-50',
            )}
            onClick={sendMessage}
            disabled={!draft.trim()}
            aria-label="Send message"
            title="Send message"
          >
            <CornerDownLeft className="size-4" aria-hidden />
          </Button>
        </div>
      </div>
    </div>
  )

  const centeredTopHints =
    centeredEmptyComposer && desktopToolsUnavailable ? (
      <div className="border-border/60 bg-background/80 shrink-0 border-b px-4 py-2 md:px-6">
        <div className="mx-auto flex max-w-5xl flex-col gap-2">
          <p className="text-text-3 text-xs">
            Workspace scripts and file tools need the desktop app.
          </p>
        </div>
      </div>
    ) : null

  const chatColumn = (
    <div
      className={cn(
        'bg-background flex h-full min-h-0 flex-col',
        !showArtifactPanel && 'flex-1',
        showArtifactPanel && !isMobile && 'md:rounded-l-xl',
        showArtifactPanel && isMobile && 'min-h-[min(100dvh,520px)]',
        !showArtifactPanel && 'md:rounded-xl md:border md:border-border',
      )}
    >
      {showCollapsedPanelRestore ? (
        <div className="border-border/60 bg-muted/15 flex shrink-0 items-center justify-end border-b px-3 py-1.5 md:px-5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => collapseArtifactPanel(sessionKey, false)}
          >
            <PanelRightOpen className="size-3.5" aria-hidden />
            Side panel
          </Button>
        </div>
      ) : null}
      {!shellHeaderToolbar ? (
        <div className="border-border/60 bg-background shrink-0 border-b px-4 py-2 md:px-6">
          <div className="mx-auto flex max-w-5xl justify-start overflow-x-auto">
            {sessionHeaderToolbarNode}
          </div>
        </div>
      ) : null}
      {centeredEmptyComposer ? (
        <>
          {centeredTopHints}
          <div
            ref={composerDropZoneRef}
            data-braian-file-drop-zone="1"
            className="flex min-h-0 flex-1 flex-col justify-center px-4 py-6 md:px-6 md:py-10"
            onDragOver={(e) => {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'copy'
            }}
            onDrop={handleComposerHtmlDrop}
          >
            <div className="mx-auto w-full max-w-5xl">
              {workspaceTargetRow}
              {composerCardSection}
            </div>
          </div>
        </>
      ) : (
        <>
          <ScrollArea
            className="min-h-0 flex-1"
            viewportRef={chatScrollViewportRef}
          >
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-5 md:px-6">
          <div className="flex flex-col gap-2">
            {isProfileSession ? (
              <p className="text-text-3 text-xs leading-relaxed">
                This chat only updates your global profile (name, location,
                languages, and notes). Everything you save here is included in
                other workspace chats. Come back anytime to add or change
                details.
              </p>
            ) : null}
            {isPersonalSimpleChat ? (
              <p className="text-text-3 text-xs leading-relaxed">
                {isTauriRuntime
                  ? 'Simple chat: use Move to workspace when you want project file tools, @ mentions, and this thread under a folder workspace.'
                  : 'Browser preview: open the desktop app for saved simple chats and moving them to a project.'}
              </p>
            ) : null}
            {desktopToolsUnavailable ? (
              <p className="text-text-3 text-xs">
                Workspace scripts and file tools need the desktop app.
              </p>
            ) : null}
          </div>
          {messages.length === 0 ? (
            <div className="border-border bg-muted/25 text-text-3 rounded-xl border border-dashed px-4 py-8 text-center text-sm leading-relaxed">
              {isProfileSession ? (
                <p className="mx-auto max-w-md leading-relaxed">
                  Say hello — the assistant will ask a few questions and save
                  what you share to your profile. You can also tell it directly
                  (for example: “My name is …, I work in …, please use
                  English and Norwegian”).
                </p>
              ) : isNewChat ? (
                'New conversation. Send a message to start; the workspace panel opens beside chat when you have a canvas.'
              ) : (
                'This thread starts empty. Send a message to chat with the assistant.'
              )}
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
                    id={`chat-message-${m.id}`}
                    key={m.id}
                    className="scroll-mt-4 flex w-full justify-center"
                  >
                    <div className="group/message relative w-full">
                      {canCopy ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className={cn(
                            'text-text-3 hover:text-text-2 absolute top-1 right-1 z-10 size-7 shrink-0 rounded-full',
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
                      {m.createdAtMs ? (
                        <div
                          className={cn(
                            'text-text-3 absolute right-1 bottom-1 z-10 text-[10px] font-medium tabular-nums select-none',
                            'opacity-0 transition-opacity md:group-hover/message:opacity-100',
                          )}
                        >
                          {formatRelativeTime(m.createdAtMs)}
                        </div>
                      ) : null}
                      <div
                        className={cn(
                          'text-[15px] leading-relaxed',
                          isUser
                            ? 'bg-muted/40 text-text-1 rounded-xl px-4 py-3 pr-10'
                            : 'text-text-2 py-1 pr-10',
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
                          <ChatAssistantMessageBody
                            message={m}
                            workspaceFileContext={
                              isProfileSession
                                ? null
                                : isTauriRuntime && activeWorkspace?.rootPath
                                  ? {
                                      isDesktop: true,
                                      workspaceRootPath:
                                        activeWorkspace.rootPath,
                                    }
                                  : null
                            }
                          />
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
              <div
                ref={chatPinSpacerRef}
                className="shrink-0"
                aria-hidden
              />
            </div>
          )}
        </div>
      </ScrollArea>
          <div
            ref={composerDropZoneRef}
            data-braian-file-drop-zone="1"
            className="border-border bg-background/95 supports-backdrop-filter:bg-background/80 shrink-0 border-t py-3 backdrop-blur-md md:py-4"
            onDragOver={(e) => {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'copy'
            }}
            onDrop={handleComposerHtmlDrop}
          >
            <div className="mx-auto w-full max-w-5xl px-4 md:px-6">
              {composerCardSection}
            </div>
          </div>
        </>
      )}
    </div>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-0 md:gap-2 md:p-2">
      <ChatContextManagerDialog
        open={contextManagerOpen}
        onOpenChange={setContextManagerOpen}
        workspaceId={
          isProfileSession
            ? USER_PROFILE_WORKSPACE_SESSION_ID
            : threadWorkspaceId
        }
        conversationId={conversationId}
        thread={thread}
        isTauriRuntime={isTauriRuntime}
      />
      <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
        <DialogContent showCloseButton={!moveBusy}>
          <DialogHeader>
            <DialogTitle>Move to project workspace</DialogTitle>
          </DialogHeader>
          <p className="text-text-3 text-sm leading-relaxed">
            Moves this simple chat into the project you pick. After moving, file
            tools, @ mentions, and the canvas use that folder.
          </p>
          <label className="flex flex-col gap-1.5">
            <span className="text-text-2 text-xs font-medium">Workspace</span>
            <select
              className="border-border bg-background text-text-1 focus-visible:ring-ring h-9 w-full rounded-md border px-2 text-sm shadow-sm focus-visible:ring-2 focus-visible:outline-none"
              value={moveTargetWs}
              disabled={moveBusy}
              onChange={(e) => setMoveTargetWs(e.target.value)}
            >
              {projectWorkspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={moveBusy}
              onClick={() => setMoveOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="gap-2"
              disabled={moveBusy || !moveTargetWs || generating}
              onClick={() => void confirmMoveToWorkspace()}
            >
              {moveBusy ? (
                <>
                  <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
                  Moving…
                </>
              ) : (
                'Move here'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {!showArtifactPanel ? (
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
                'flex h-full min-h-0 flex-col gap-2 p-2 md:p-3',
                isMobile ? 'bg-muted/20 min-h-[280px]' : 'bg-muted/30 md:bg-transparent',
                !isMobile && 'md:rounded-r-xl',
              )}
            >
              <div className="border-border/55 flex min-h-9 shrink-0 items-center gap-1 border-b pb-2">
                <div
                  className="flex min-w-0 flex-1 gap-1 overflow-x-auto"
                  role="tablist"
                  aria-label="Open canvases"
                >
                  {artifactTabs.map((tab) => (
                    <div
                      key={tab.id}
                      className={cn(
                        'border-border/50 flex max-w-[11rem] shrink-0 items-center gap-0 overflow-hidden rounded-md border',
                        tab.id === activeArtifactTabId
                          ? 'border-border bg-muted/60'
                          : 'bg-transparent',
                      )}
                    >
                      <button
                        type="button"
                        role="tab"
                        aria-selected={tab.id === activeArtifactTabId}
                        className={cn(
                          'text-text-2 hover:bg-muted/50 min-w-0 flex-1 truncate px-2 py-1 text-left text-xs transition-colors',
                          tab.id === activeArtifactTabId ? 'text-text-1' : '',
                        )}
                        onClick={() => setActiveArtifactTab(sessionKey, tab.id)}
                      >
                        {artifactTabLabel(tab)}
                      </button>
                      <button
                        type="button"
                        className="text-text-3 hover:text-text-2 hover:bg-muted/40 shrink-0 px-1 py-1"
                        aria-label={`Close ${artifactTabLabel(tab)}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          closeArtifactTab(sessionKey, tab.id)
                        }}
                      >
                        <X className="size-3" aria-hidden />
                      </button>
                    </div>
                  ))}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-text-3 size-8 shrink-0"
                  title="Collapse side panel"
                  aria-label="Collapse side panel"
                  onClick={() => collapseArtifactPanel(sessionKey, true)}
                >
                  <PanelRightClose className="size-4" aria-hidden />
                </Button>
              </div>
              <div className="min-h-0 flex-1">
                <ArtifactPanel
                  payload={artifactPayload}
                  agentMode={agentMode}
                  appPreviewWorkspaceId={
                    isProfileSession || isPersonalSimpleChat
                      ? null
                      : threadWorkspaceId
                  }
                  appPreviewSessionKey={
                    isProfileSession || isPersonalSimpleChat ? null : sessionKey
                  }
                  appPreviewGenerating={generating}
                  isTauriRuntime={isTauriRuntime}
                  documentLiveSessionKey={canvasLiveKey}
                  onCanvasSelectionAsk={
                    isProfileSession || isPersonalSimpleChat
                      ? undefined
                      : ({ instruction, selectedMarkdown }) => {
                          sendChatTurn(sessionKey, instruction, {
                            canvasSelection: {
                              selectedMarkdown,
                              sectionOnly: true,
                            },
                          })
                        }
                  }
                  onDocumentBodyChange={(body) =>
                    patchDocumentArtifactBody(sessionKey, body)
                  }
                  workspaceFileWorkspaceId={
                    isProfileSession || isPersonalSimpleChat
                      ? null
                      : threadWorkspaceId
                  }
                  workspaceFileSessionKey={
                    isProfileSession || isPersonalSimpleChat ? null : sessionKey
                  }
                  workspaceFileLiveSessionKey={canvasLiveKey}
                />
              </div>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
    </div>
  )
}
