import {
  Brain,
  Braces,
  Camera,
  Check,
  Copy,
  CornerDownLeft,
  FileText,
  Loader2,
  MessageSquare,
  Paperclip,
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

import { ChatContextManagerDialog } from '@/components/app/chat-context-manager-dialog'
import {
  assistantPlainTextForCopy,
  ChatAssistantMessageBody,
  ChatUserMessageBody,
} from '@/components/app/chat-message-body'
import { ArtifactPanel } from '@/components/app/artifact-panel'
import { useOptionalShellHeaderToolbar } from '@/components/app/shell-header-toolbar'
import { useWorkspace } from '@/components/app/workspace-context'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable'
import { ScrollArea } from '@/components/ui/scroll-area'
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
  USER_PROFILE_WORKSPACE_SESSION_ID,
} from '@/lib/chat-sessions/detached'
import { chatSessionKey } from '@/lib/chat-sessions/keys'
import { PROFILE_CHAT_SESSION_KEY } from '@/lib/chat-sessions/store'
import { type ChatThreadState } from '@/lib/chat-sessions/types'
import {
  getThreadSnapshot,
  replaceThread,
  seedCanvasPreviewIfEmpty,
  useChatThread,
  useChatThreadActions,
} from '@/lib/chat-sessions/store'
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
  buildConversationSavePayload,
  conversationList,
  conversationMoveToWorkspace,
  conversationSave,
  workspaceImportFile,
  workspaceListAllFiles,
  type ConversationDto,
  type WorkspaceFileIndexEntry,
} from '@/lib/workspace-api'
import { workspaceHubRecentFileTouch } from '@/lib/workspace-hub-api'
import { workspaceGitTryCommit } from '@/lib/workspace/git-history-api'
import { cn } from '@/lib/utils'

function normalizeCanvasKind(
  s: string | undefined,
): 'document' | 'tabular' | 'visual' {
  if (s === 'tabular' || s === 'tabular-multi') return 'tabular'
  if (s === 'visual') return 'visual'
  return 'document'
}

type ChatSessionHeaderToolbarProps = {
  onOpenContext: () => void
  generating: boolean
  sessionKey: string
  stopChatGeneration: (key: string) => void
  isPersonalSimpleChat: boolean
  isTauriRuntime: boolean
  projectWorkspacesLength: number
  moveBusy: boolean
  onMoveOpen: () => void
  conversationId: string | null
  isProfileSession: boolean
  snapshotBusy: boolean
  onSaveSnapshotNow: () => void
  memoryUpdateBusy: boolean
  onUpdateMemoryNow: () => void
  activeAgentSegment: 'document' | 'code' | 'app'
  onSelectAgentSegment: (next: 'document' | 'code' | 'app') => void
}

/** Shared header toolbar control surface (height, radius, border). */
const headerToolbarBtnClass =
  'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-border/55 bg-muted/20 px-2.5 text-[13px] font-medium text-text-2 shadow-sm transition-colors hover:border-border hover:bg-muted/40 hover:text-text-1 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50'

const headerToolbarContextBtnClass = cn(
  headerToolbarBtnClass,
  'border-accent-500/25 bg-accent-500/[0.07] text-accent-700 hover:border-accent-500/45 hover:bg-accent-500/12 dark:text-accent-400',
)

function ChatSessionHeaderToolbar({
  onOpenContext,
  generating,
  sessionKey,
  stopChatGeneration,
  isPersonalSimpleChat,
  isTauriRuntime,
  projectWorkspacesLength,
  moveBusy,
  onMoveOpen,
  conversationId,
  isProfileSession,
  snapshotBusy,
  onSaveSnapshotNow,
  memoryUpdateBusy,
  onUpdateMemoryNow,
  activeAgentSegment,
  onSelectAgentSegment,
}: ChatSessionHeaderToolbarProps) {
  const showWorkspaceMove =
    isPersonalSimpleChat &&
    isTauriRuntime &&
    projectWorkspacesLength > 0
  const showAgentModes =
    Boolean(conversationId) &&
    isTauriRuntime &&
    !isPersonalSimpleChat &&
    !isProfileSession
  const showSnapshot =
    !generating &&
    Boolean(conversationId) &&
    isTauriRuntime &&
    !isProfileSession &&
    !isPersonalSimpleChat
  const showMemory =
    !generating &&
    Boolean(conversationId) &&
    isTauriRuntime &&
    !isProfileSession &&
    !isPersonalSimpleChat

  const modeSegments = (
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
        'focus-visible:ring-ring h-full min-w-0 px-2 text-center text-[13px] font-medium transition-colors focus-visible:z-10 focus-visible:ring-2 focus-visible:outline-none sm:px-2.5',
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
      onClick={() => onSelectAgentSegment(seg.id)}
    >
      {seg.label}
    </button>
  ))

  const agentModeGroup = (
    <div
      className="border-border/60 bg-muted/20 inline-grid h-8 w-[14.25rem] shrink-0 grid-cols-3 divide-x divide-border/55 overflow-hidden rounded-md border shadow-sm sm:w-[15.5rem]"
      role="group"
      aria-label="Agent mode"
    >
      {modeSegments}
    </div>
  )

  return (
    <div className="inline-flex w-max max-w-none items-center gap-1.5 pr-1">
      <button
        type="button"
        className={headerToolbarContextBtnClass}
        onClick={onOpenContext}
      >
        <Braces className="size-3.5 shrink-0 opacity-80" aria-hidden />
        Context
      </button>
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
      {showAgentModes ? agentModeGroup : null}
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
      {showSnapshot ? (
        <button
          type="button"
          className={headerToolbarBtnClass}
          disabled={snapshotBusy}
          title="Save the workspace folder to Git now (after saving this chat)"
          onClick={onSaveSnapshotNow}
        >
          {snapshotBusy ? (
            <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
          ) : (
            <Camera className="size-3.5 shrink-0" aria-hidden />
          )}
          Save snapshot
        </button>
      ) : null}
      {showMemory ? (
        <button
          type="button"
          className={headerToolbarBtnClass}
          disabled={memoryUpdateBusy}
          title="Update workspace memory from this chat"
          onClick={onUpdateMemoryNow}
        >
          {memoryUpdateBusy ? (
            <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
          ) : (
            <Brain className="size-3.5 shrink-0" aria-hidden />
          )}
          Update memory
        </button>
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
    addContextFileEntry,
    removeContextFileEntry,
    addContextConversationEntry,
    removeContextConversationEntry,
  } = useChatThreadActions()

  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null)
  const [memoryUpdateBusy, setMemoryUpdateBusy] = useState(false)
  const [memoryUpdateHint, setMemoryUpdateHint] = useState<string | null>(null)
  const [snapshotBusy, setSnapshotBusy] = useState(false)
  const [snapshotHint, setSnapshotHint] = useState<string | null>(null)
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
    artifactOpen,
    artifactPayload,
    draft,
    generating,
    pendingUserMessages,
    contextFiles,
    contextConversations,
    agentMode,
    reasoningMode,
  } = thread

  const showArtifactPanel =
    (artifactOpen || agentMode === 'app') && !isProfileSession

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
    const viewport = chatScrollViewportRef.current
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
          if (inside && 'paths' in e.payload && e.payload.paths.length > 0) {
            await onNativeFileDrop(e.payload.paths)
          }
        }
      })
    })()
    return () => {
      alive = false
      unlisten?.()
    }
  }, [isTauriRuntime, isProfileSession, onNativeFileDrop])

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

  const onUpdateMemoryNow = useCallback(() => {
    if (!conversationId || !activeWorkspaceId || memoryUpdateBusy) return
    setMemoryUpdateBusy(true)
    setMemoryUpdateHint(null)
    void import('@/lib/memory/scheduler')
      .then((m) => m.runMemoryReviewNow(activeWorkspaceId, conversationId))
      .then((r) => {
        if (r.ok && r.skipped) {
          setMemoryUpdateHint(r.reason)
        } else if (!r.ok) {
          setMemoryUpdateHint(r.error)
        } else {
          setMemoryUpdateHint('Memory file updated (.braian/MEMORY.md).')
        }
      })
      .catch((e) => {
        setMemoryUpdateHint(
          e instanceof Error ? e.message : 'Memory update failed.',
        )
      })
      .finally(() => {
        setMemoryUpdateBusy(false)
        window.setTimeout(() => setMemoryUpdateHint(null), 6000)
      })
  }, [activeWorkspaceId, conversationId, memoryUpdateBusy])

  const onSaveSnapshotNow = useCallback(() => {
    if (
      !conversationId ||
      !threadWorkspaceId ||
      snapshotBusy ||
      generating ||
      isPersonalSimpleChat ||
      isProfileSession
    ) {
      return
    }
    setSnapshotBusy(true)
    setSnapshotHint(null)
    void (async () => {
      try {
        if (metaForSave) {
          await conversationSave(
            buildConversationSavePayload(thread, metaForSave),
          )
          await refreshConversations()
        }
        const oid = await workspaceGitTryCommit(threadWorkspaceId, 'manual')
        if (oid) {
          setSnapshotHint('Workspace snapshot saved.')
        } else {
          setSnapshotHint(
            'No snapshot created. Turn on workspace snapshots in settings, or nothing changed on disk.',
          )
        }
      } catch (e) {
        setSnapshotHint(
          e instanceof Error ? e.message : 'Could not save snapshot.',
        )
      } finally {
        setSnapshotBusy(false)
        window.setTimeout(() => setSnapshotHint(null), 8000)
      }
    })()
  }, [
    conversationId,
    threadWorkspaceId,
    snapshotBusy,
    generating,
    isPersonalSimpleChat,
    isProfileSession,
    metaForSave,
    thread,
    refreshConversations,
  ])

  const desktopToolsUnavailable =
    (agentMode === 'code' || agentMode === 'app') && !isTauriRuntime

  const queuedCount = pendingUserMessages.length

  const activeAgentSegment: 'document' | 'code' | 'app' =
    agentMode === 'app' ? 'app' : agentMode === 'code' ? 'code' : 'document'

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

  const sessionHeaderToolbarNode = useMemo(
    () => (
      <ChatSessionHeaderToolbar
        onOpenContext={openContextManager}
        generating={generating}
        sessionKey={sessionKey}
        stopChatGeneration={stopChatGeneration}
        isPersonalSimpleChat={isPersonalSimpleChat}
        isTauriRuntime={isTauriRuntime}
        projectWorkspacesLength={projectWorkspaces.length}
        moveBusy={moveBusy}
        onMoveOpen={openMoveDialog}
        conversationId={conversationId}
        isProfileSession={isProfileSession}
        snapshotBusy={snapshotBusy}
        onSaveSnapshotNow={onSaveSnapshotNow}
        memoryUpdateBusy={memoryUpdateBusy}
        onUpdateMemoryNow={onUpdateMemoryNow}
        activeAgentSegment={activeAgentSegment}
        onSelectAgentSegment={onSelectAgentSegment}
      />
    ),
    [
      openContextManager,
      generating,
      sessionKey,
      stopChatGeneration,
      isPersonalSimpleChat,
      isTauriRuntime,
      projectWorkspaces.length,
      moveBusy,
      openMoveDialog,
      conversationId,
      isProfileSession,
      snapshotBusy,
      onSaveSnapshotNow,
      memoryUpdateBusy,
      onUpdateMemoryNow,
      activeAgentSegment,
      onSelectAgentSegment,
    ],
  )

  useLayoutEffect(() => {
    if (!shellHeaderToolbar) return
    shellHeaderToolbar.setToolbar(sessionHeaderToolbarNode)
    return () => {
      shellHeaderToolbar.setToolbar(null)
    }
  }, [shellHeaderToolbar, sessionHeaderToolbarNode])

  const isThinking = reasoningMode === 'thinking'

  const reasoningModeGroup = (
    <button
      type="button"
      className={cn(
        'focus-visible:ring-ring flex h-8 items-center justify-center rounded-full border px-3.5 text-[13px] font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2',
        isThinking
          ? 'border-primary/30 bg-primary/10 text-primary hover:bg-primary/20'
          : 'border-border/50 bg-transparent text-text-3 hover:bg-muted/50 hover:text-text-2'
      )}
      onClick={() => setChatReasoningMode(sessionKey, isThinking ? 'fast' : 'thinking')}
      title={
        isThinking
          ? 'Thinking mode: More reasoning time; may show thinking when the model supports it'
          : 'Fast mode: Lower latency; minimal or no visible chain-of-thought'
      }
    >
      {isThinking ? 'Thinking' : 'Fast'}
    </button>
  )

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
      {!shellHeaderToolbar ? (
        <div className="border-border/60 bg-background shrink-0 border-b px-4 py-2 md:px-6">
          <div className="mx-auto flex max-w-5xl justify-start overflow-x-auto">
            {sessionHeaderToolbarNode}
          </div>
        </div>
      ) : null}
      <ScrollArea
        className="min-h-0 flex-1"
        viewportRef={chatScrollViewportRef}
      >
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-5 md:px-6">
          <div className="flex flex-col gap-2">
            {memoryUpdateHint ? (
              <p className="text-text-3 text-xs">{memoryUpdateHint}</p>
            ) : null}
            {snapshotHint ? (
              <p className="text-text-3 text-xs">{snapshotHint}</p>
            ) : null}
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
            {contextFiles.length > 0 ? (
              <p
                className="text-text-3 text-xs"
                title="Attached file contents are sent to your configured AI provider when you send a message."
              >
                {contextFiles.length} file
                {contextFiles.length === 1 ? '' : 's'} in context
              </p>
            ) : null}
            {contextConversations.length > 0 ? (
              <p
                className="text-text-3 text-xs"
                title="Attached chat transcripts are sent to your configured AI provider when you send a message."
              >
                {contextConversations.length} other chat
                {contextConversations.length === 1 ? '' : 's'} in context
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
        className="border-border bg-background/95 supports-backdrop-filter:bg-background/80 shrink-0 border-t py-3 backdrop-blur-md md:py-4"
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }}
        onDrop={(e) => {
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
        }}
      >
        <div className="mx-auto w-full max-w-5xl px-4 md:px-6">
        {contextFiles.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {contextFiles.map((f) => (
              <Badge
                key={f.relativePath}
                variant="secondary"
                className="text-text-2 border-border max-w-full gap-1 pr-0.5 font-normal"
                title={f.relativePath}
              >
                <FileText
                  className="text-text-3 size-3.5 shrink-0"
                  aria-hidden
                />
                <span className="max-w-[14rem] truncate">
                  {f.displayName?.trim() ||
                    f.relativePath.split('/').pop() ||
                    f.relativePath}
                </span>
                <button
                  type="button"
                  className="hover:bg-muted rounded-full p-0.5"
                  aria-label={`Remove file ${f.displayName?.trim() || f.relativePath}`}
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
        {contextConversations.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {contextConversations.map((c) => {
              const label = c.title?.trim() || c.conversationId
              return (
                <Badge
                  key={c.conversationId}
                  variant="outline"
                  className="text-accent-700 border-accent-500/35 max-w-full gap-1 pr-0.5 font-normal dark:text-accent-500"
                  title={c.conversationId}
                >
                  <MessageSquare
                    className="text-accent-600 size-3.5 shrink-0 dark:text-accent-500"
                    aria-hidden
                  />
                  <span className="max-w-[14rem] truncate">Chat: {label}</span>
                  <button
                    type="button"
                    className="hover:bg-accent-500/10 rounded-full p-0.5"
                    aria-label={`Remove chat from context: ${label}`}
                    onClick={() =>
                      removeContextConversationEntry(
                        sessionKey,
                        c.conversationId,
                      )
                    }
                  >
                    <X className="size-3 opacity-70" aria-hidden />
                  </button>
                </Badge>
              )
            })}
          </div>
        ) : null}
        <div
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
                        (idx === 0 ||
                          mentionOptions[idx - 1]?.kind === 'file')
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
            className="min-h-[120px] resize-none border-0 bg-transparent px-4 pt-4 pb-14 text-sm shadow-none focus-visible:ring-0"
          />
          <div className="pointer-events-none absolute bottom-2 left-2 right-2 flex items-center justify-between">
            <div className="pointer-events-auto flex min-w-0 flex-wrap items-center gap-1.5 pl-1">
              {isTauriRuntime &&
              activeWorkspace?.rootPath &&
              !isPersonalSimpleChat &&
              !isProfileSession ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-text-3 hover:text-text-2 hover:bg-muted/50 size-8 shrink-0 rounded-full transition-colors"
                  onClick={() => void onAttachFiles()}
                  aria-label="Attach files"
                  title="Attach files to this chat"
                >
                  <Paperclip className="size-4" aria-hidden />
                </Button>
              ) : null}
              {reasoningModeGroup}
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
                  "size-8 shrink-0 rounded-full transition-all duration-200",
                  draft.trim() 
                    ? "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90" 
                    : "bg-muted text-text-3 opacity-50"
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
        </div>
      </div>
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
                'h-full min-h-0 p-2 md:p-3',
                isMobile ? 'bg-muted/20 min-h-[280px]' : 'bg-muted/30 md:bg-transparent',
                !isMobile && 'md:rounded-r-xl',
              )}
            >
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
                documentLiveSessionKey={
                  isProfileSession || isPersonalSimpleChat ? undefined : sessionKey
                }
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
              />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
    </div>
  )
}
