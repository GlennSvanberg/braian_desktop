import {
  Brain,
  Check,
  Copy,
  CornerDownLeft,
  FolderOpen,
  Loader2,
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
import { useNavigate, useRouter } from '@tanstack/react-router'

import {
  ChatContextManagerDialog,
  ChatContextManagerTriggerButton,
} from '@/components/app/chat-context-manager-dialog'
import {
  assistantPlainTextForCopy,
  ChatAssistantMessageBody,
  ChatUserMessageBody,
} from '@/components/app/chat-message-body'
import { ArtifactPanel } from '@/components/app/artifact-panel'
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
  applyMentionToDraft,
  filterWorkspaceFilesForMention,
  getMentionQuery,
} from '@/lib/chat-mention-files'
import {
  DETACHED_WORKSPACE_SESSION_ID,
  USER_PROFILE_WORKSPACE_SESSION_ID,
} from '@/lib/chat-sessions/detached'
import { chatSessionKey } from '@/lib/chat-sessions/keys'
import { PROFILE_CHAT_SESSION_KEY } from '@/lib/chat-sessions/store'
import {
  DEFAULT_CHAT_THREAD,
  type ChatThreadState,
} from '@/lib/chat-sessions/types'
import {
  getThreadSnapshot,
  replaceThread,
  seedCanvasPreviewIfEmpty,
  useChatThread,
  useChatThreadActions,
} from '@/lib/chat-sessions/store'
import {
  DEFAULT_AGENT_TITLE,
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
  conversationCreate,
  conversationSave,
  workspaceImportFile,
  workspaceListAllFiles,
  type ConversationDto,
  type WorkspaceFileIndexEntry,
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
  /**
   * When true with `conversationId === null` (e.g. `/chat/new`), the thread is not tied to the
   * active workspace until the user uses “Move to workspace”.
   */
  useDetachedSession?: boolean
  /** Global profile coach (sidebar → You): dedicated session and tools only. */
  variant?: 'workspace' | 'profile'
}

export function ChatWorkbench({
  conversationId,
  conversationMeta,
  initialThread = null,
  useDetachedSession = false,
  variant = 'workspace',
}: ChatWorkbenchProps) {
  const isProfileSession = variant === 'profile'
  const isDetachedSession =
    useDetachedSession === true && conversationId === null && !isProfileSession
  const navigate = useNavigate()
  const router = useRouter()
  const {
    activeWorkspaceId,
    activeWorkspace,
    refreshConversations,
    refreshConversationLists,
    workspaces,
    setActiveWorkspaceId,
    isTauriRuntime,
  } = useWorkspace()
  const lastSerializedRef = useRef<string | null>(null)
  const initialThreadRef = useRef(initialThread)
  initialThreadRef.current = initialThread
  /** Must match sidebar / disk: thread is owned by the conversation's workspace, not the UI-selected workspace. */
  const threadWorkspaceId = useMemo(() => {
    if (isProfileSession || isDetachedSession) return activeWorkspaceId
    if (conversationId != null && conversationMeta?.workspaceId) {
      return conversationMeta.workspaceId
    }
    return activeWorkspaceId
  }, [
    isProfileSession,
    isDetachedSession,
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
        : isDetachedSession
          ? chatSessionKey(DETACHED_WORKSPACE_SESSION_ID, null)
          : chatSessionKey(threadWorkspaceId, conversationId),
    [isProfileSession, isDetachedSession, threadWorkspaceId, conversationId],
  )
  const thread = useChatThread(sessionKey)
  const {
    sendChatTurn,
    setChatDraft,
    patchDocumentArtifactBody,
    stopChatGeneration,
    setChatAgentMode,
    setChatAppHarnessEnabled,
    setChatReasoningMode,
    addContextFileEntry,
    removeContextFileEntry,
  } = useChatThreadActions()

  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null)
  const [memoryUpdateBusy, setMemoryUpdateBusy] = useState(false)
  const [memoryUpdateHint, setMemoryUpdateHint] = useState<string | null>(null)
  const [workspaceFileIndex, setWorkspaceFileIndex] = useState<
    WorkspaceFileIndexEntry[]
  >([])
  const [caretPos, setCaretPos] = useState(0)
  const [mentionHighlight, setMentionHighlight] = useState(0)
  const [mentionMenuSuppressed, setMentionMenuSuppressed] = useState(false)
  const [fileDragHighlight, setFileDragHighlight] = useState(false)
  const [contextManagerOpen, setContextManagerOpen] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)
  const [moveTargetWs, setMoveTargetWs] = useState('')
  const [moveBusy, setMoveBusy] = useState(false)
  const [movingIntoWorkspaceId, setMovingIntoWorkspaceId] = useState<
    string | null
  >(null)
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
        (isDetachedSession ? DEFAULT_AGENT_TITLE : DEFAULT_CHAT_TITLE)),
  )
  const autoTitleAppliedRef = useRef<string | null>(null)
  const isNewChat = conversationId === null

  useEffect(() => {
    if (!isDetachedSession || isProfileSession) return
    if (autoTitleAppliedRef.current === 'detached-title') return
    if (
      conversationTitle !== DEFAULT_AGENT_TITLE &&
      conversationTitle !== DEFAULT_CHAT_TITLE
    ) {
      return
    }
    const firstUser = thread.messages.find(
      (m) => m.role === 'user' && m.content.trim().length > 0,
    )
    if (!firstUser) return
    setConversationTitle(deriveConversationTitle(firstUser.content))
    autoTitleAppliedRef.current = 'detached-title'
  }, [isDetachedSession, isProfileSession, conversationTitle, thread.messages])

  useEffect(() => {
    if (!moveOpen || workspaces.length === 0) return
    setMoveTargetWs((prev) => {
      if (prev && workspaces.some((w) => w.id === prev)) return prev
      if (
        activeWorkspaceId &&
        workspaces.some((w) => w.id === activeWorkspaceId)
      ) {
        return activeWorkspaceId
      }
      return workspaces[0]?.id ?? ''
    })
  }, [moveOpen, workspaces, activeWorkspaceId])

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
    agentMode,
    appHarnessEnabled,
    reasoningMode,
  } = thread

  const showArtifactPanel = artifactOpen && !isProfileSession

  const mention = useMemo(
    () => getMentionQuery(draft, caretPos),
    [draft, caretPos],
  )
  const mentionOptions = useMemo(
    () =>
      mention
        ? filterWorkspaceFilesForMention(workspaceFileIndex, mention.query)
        : [],
    [mention, workspaceFileIndex],
  )
  const showMentionList =
    mention != null &&
    !mentionMenuSuppressed &&
    !isDetachedSession &&
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
        isDetachedSession ||
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
            mentionTags.push(`@${name}`)
          } else {
            const { relativePath, displayName } = await workspaceImportFile(
              activeWorkspaceId,
              abs,
            )
            addContextFileEntry(sessionKey, { relativePath, displayName })
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
      isDetachedSession,
      isProfileSession,
      isTauriRuntime,
      sessionKey,
    ],
  )

  const onAttachFiles = useCallback(async () => {
    if (
      isDetachedSession ||
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
    isDetachedSession,
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
      !activeWorkspaceId ||
      isDetachedSession ||
      isProfileSession
    ) {
      setWorkspaceFileIndex([])
      return
    }
    let cancelled = false
    void workspaceListAllFiles(activeWorkspaceId)
      .then((rows) => {
        if (!cancelled) setWorkspaceFileIndex(rows)
      })
      .catch((e) => console.error('[braian] workspace file index', e))
    return () => {
      cancelled = true
    }
  }, [isTauriRuntime, activeWorkspaceId, isDetachedSession, isProfileSession])

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
    (pick: WorkspaceFileIndexEntry) => {
      const ta = textareaRef.current
      const caret = ta?.selectionStart ?? caretPos
      const m = getMentionQuery(draft, caret)
      if (!m) return
      const { nextDraft, nextCaret } = applyMentionToDraft(
        draft,
        caret,
        m.start,
        pick,
      )
      setChatDraft(sessionKey, nextDraft)
      addContextFileEntry(sessionKey, {
        relativePath: pick.relativePath,
        displayName: pick.name,
      })
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
      if (!isDetachedSession || !targetWorkspaceId || moveBusy || generating)
        return
      setMoveBusy(true)
      setMovingIntoWorkspaceId(targetWorkspaceId)
      try {
        const threadNow = getThreadSnapshot(sessionKey)
        const created = await conversationCreate(targetWorkspaceId)
        const trimmedTitle = conversationTitle.trim()
        const title =
          trimmedTitle &&
          trimmedTitle !== DEFAULT_AGENT_TITLE &&
          trimmedTitle !== DEFAULT_CHAT_TITLE
            ? trimmedTitle
            : (() => {
                const firstUser = threadNow.messages.find(
                  (m) => m.role === 'user' && m.content.trim().length > 0,
                )
                return firstUser
                  ? deriveConversationTitle(firstUser.content)
                  : created.title
              })()
        const meta = {
          id: created.id,
          workspaceId: targetWorkspaceId,
          title,
          canvasKind: created.canvasKind,
          pinned: created.pinned,
          unread: created.unread,
        }
        const payload = buildConversationSavePayload(threadNow, meta)
        await conversationSave(payload)
        await refreshConversationLists()
        replaceThread(sessionKey, { ...DEFAULT_CHAT_THREAD })
        setActiveWorkspaceId(targetWorkspaceId)
        setMoveOpen(false)
        navigate({
          to: '/chat/$conversationId',
          params: { conversationId: created.id },
        })
        await router.invalidate()
      } catch (e) {
        console.error(e)
        window.alert(e instanceof Error ? e.message : String(e))
      } finally {
        setMoveBusy(false)
        setMovingIntoWorkspaceId(null)
      }
    },
    [
      isDetachedSession,
      moveBusy,
      generating,
      sessionKey,
      conversationTitle,
      refreshConversationLists,
      setActiveWorkspaceId,
      navigate,
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

  const desktopToolsUnavailable = agentMode === 'code' && !isTauriRuntime

  const queuedCount = pendingUserMessages.length

  /** Single visible mode: code wins over document; app = document + dashboard harness. */
  const activeAgentSegment: 'document' | 'code' | 'app' =
    agentMode === 'code'
      ? 'code'
      : appHarnessEnabled
        ? 'app'
        : 'document'

  const onSelectAgentSegment = useCallback(
    (next: 'document' | 'code' | 'app') => {
      if (next === 'code') {
        setChatAgentMode(sessionKey, 'code')
        return
      }
      setChatAgentMode(sessionKey, 'document')
      setChatAppHarnessEnabled(sessionKey, next === 'app')
    },
    [sessionKey, setChatAgentMode, setChatAppHarnessEnabled],
  )

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

  const agentModeGroup = (
    <div
      className="bg-muted/30 flex h-8 shrink-0 items-center overflow-hidden rounded-full p-1"
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
            'focus-visible:ring-ring h-full rounded-full px-3.5 text-[13px] font-medium transition-all duration-200 focus-visible:z-10 focus-visible:ring-2 focus-visible:outline-none',
            activeAgentSegment === seg.id
              ? 'bg-background text-text-1 shadow-sm'
              : 'text-text-3 hover:text-text-2 bg-transparent',
          )}
          aria-pressed={activeAgentSegment === seg.id}
          title={
            seg.id === 'document'
              ? 'Document assistant: canvas, lazy file tools'
              : seg.id === 'code'
                ? 'Code assistant: eager read/write/run in workspace'
                : 'App builder: dashboard & in-app pages tools'
          }
          onClick={() => onSelectAgentSegment(seg.id)}
        >
          {seg.label}
        </button>
      ))}
    </div>
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
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-6 px-4 py-5 md:px-5">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <p className="text-text-1 truncate text-sm font-medium md:text-base">
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
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <ChatContextManagerTriggerButton
                  onClick={() => setContextManagerOpen(true)}
                />
                {isDetachedSession && isTauriRuntime && workspaces.length > 0 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-text-2 hover:text-text-1 hover:bg-muted/50 border-border/40 h-8 gap-1.5 rounded-full border px-3.5 text-[13px] transition-colors"
                    disabled={generating || moveBusy}
                    onClick={() => setMoveOpen(true)}
                  >
                    Move to workspace
                  </Button>
                ) : null}
                {conversationId &&
                isTauriRuntime &&
                !isDetachedSession &&
                !isProfileSession ? (
                  agentModeGroup
                ) : null}
                {generating ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-text-2 hover:text-text-1 hover:bg-muted/50 border-border/40 h-8 gap-1.5 rounded-full border px-3.5 text-[13px] transition-colors"
                    onClick={() => stopChatGeneration(sessionKey)}
                  >
                    <Square className="size-2.5 fill-current" aria-hidden />
                    Stop
                  </Button>
                ) : null}
                {!generating &&
                conversationId &&
                isTauriRuntime &&
                !isProfileSession ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-text-2 hover:text-text-1 hover:bg-muted/50 border-border/40 h-8 gap-1.5 rounded-full border px-3.5 text-[13px] transition-colors"
                    disabled={memoryUpdateBusy}
                    onClick={onUpdateMemoryNow}
                  >
                    {memoryUpdateBusy ? (
                      <Loader2
                        className="size-3.5 shrink-0 animate-spin"
                        aria-hidden
                      />
                    ) : (
                      <Brain className="size-3.5 shrink-0" aria-hidden />
                    )}
                    Update memory
                  </Button>
                ) : null}
              </div>
            </div>
            {memoryUpdateHint ? (
              <p className="text-text-3 text-xs">{memoryUpdateHint}</p>
            ) : null}
            {isProfileSession ? (
              <p className="text-text-3 text-xs leading-relaxed">
                This chat only updates your global profile (name, location,
                languages, and notes). Everything you save here is included in
                other workspace chats. Come back anytime to add or change
                details.
              </p>
            ) : null}
            {isDetachedSession ? (
              <p className="text-text-3 text-xs leading-relaxed">
                {isTauriRuntime
                  ? 'This agent is not in a workspace yet. Use Move to workspace when you want file tools, @ mentions, and a saved thread under a project folder.'
                  : 'Browser preview: open the desktop app to move this agent into a workspace when you are ready.'}
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
                isDetachedSession ? (
                  isTauriRuntime && workspaces.length > 0 ? (
                    <div className="flex flex-col items-center gap-6">
                      <p className="max-w-md leading-relaxed">
                        New agent (no workspace yet). Send a message to start,
                        or move into a workspace when you are ready so this
                        thread is saved with a project and file tools are
                        available.
                      </p>
                      <div className="flex w-full max-w-md flex-col gap-3">
                        {workspaces.map((w) => (
                          <Button
                            key={w.id}
                            type="button"
                            variant="outline"
                            size="lg"
                            className="border-border/40 text-text-1 hover:bg-muted/60 h-auto min-h-14 justify-start gap-3 rounded-2xl px-4 py-3 text-left text-base font-medium shadow-sm transition-all duration-200 hover:shadow-md"
                            disabled={generating || moveBusy}
                            onClick={() => void runMoveToWorkspace(w.id)}
                          >
                            {moveBusy && movingIntoWorkspaceId === w.id ? (
                              <Loader2
                                className="text-text-3 size-5 shrink-0 animate-spin"
                                aria-hidden
                              />
                            ) : (
                              <FolderOpen
                                className="text-accent-600 size-5 shrink-0"
                                aria-hidden
                              />
                            )}
                            <span className="min-w-0 flex-1 truncate">
                              {w.name}
                            </span>
                          </Button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    'New agent (no workspace yet). Send a message to start. When you are ready, use Move to workspace so this thread is saved with a project and file tools are available.'
                  )
                ) : (
                  'New conversation. Send a message to start; the workspace panel opens beside chat when you have a canvas.'
                )
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
                    key={m.id}
                    className={cn(
                      'flex',
                      isUser ? 'justify-end' : 'justify-start',
                    )}
                  >
                    <div
                      className={cn(
                        'group/message relative max-w-[min(100%,40rem)] sm:max-w-[min(100%,44rem)] md:max-w-[min(100%,52rem)] lg:max-w-[min(100%,64rem)] xl:max-w-[min(100%,min(90vw,76rem))] 2xl:max-w-[min(100%,min(92vw,88rem))]',
                        !isUser && 'w-full',
                      )}
                    >
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
                          'px-4 py-3 text-[15px] leading-relaxed',
                          isUser
                            ? 'bg-primary text-primary-foreground rounded-[20px] rounded-tr-[4px] pr-10'
                            : 'bg-muted/30 text-text-2 rounded-[20px] rounded-tl-[4px] border border-border/40 pr-10',
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
            </div>
          )}
        </div>
      </ScrollArea>
      <div
        ref={composerDropZoneRef}
        className="border-border bg-background/95 supports-backdrop-filter:bg-background/80 shrink-0 border-t p-3 backdrop-blur-md md:p-4"
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
              aria-label="Attach workspace file"
            >
              <ScrollArea className="max-h-52">
                <ul className="py-1">
                  {mentionOptions.length === 0 ? (
                    <li className="text-text-3 px-3 py-2 text-xs">
                      No matching files
                    </li>
                  ) : (
                    mentionOptions.map((opt, idx) => (
                      <li key={opt.relativePath}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={idx === mentionHighlight}
                          className={cn(
                            'hover:bg-muted/80 flex w-full flex-col gap-0.5 px-3 py-2 text-left text-xs',
                            idx === mentionHighlight && 'bg-muted',
                          )}
                          onMouseEnter={() => setMentionHighlight(idx)}
                          onMouseDown={(ev) => {
                            ev.preventDefault()
                            pickMention(opt)
                          }}
                        >
                          <span className="text-text-1 font-medium">
                            {opt.name}
                          </span>
                          <span className="text-text-3 truncate">
                            {opt.relativePath}
                          </span>
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              </ScrollArea>
            </div>
          ) : null}
          <Textarea
            ref={textareaRef}
            placeholder={
              isProfileSession
                ? 'Message Braian…'
                : isDetachedSession
                  ? 'Message Braian…'
                  : 'Message Braian…'
            }
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
              !isDetachedSession &&
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
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-0 md:gap-2 md:p-2">
      <ChatContextManagerDialog
        open={contextManagerOpen}
        onOpenChange={setContextManagerOpen}
        workspaceId={
          isProfileSession
            ? USER_PROFILE_WORKSPACE_SESSION_ID
            : isDetachedSession
              ? DETACHED_WORKSPACE_SESSION_ID
              : activeWorkspaceId
        }
        conversationId={conversationId}
        thread={thread}
        isTauriRuntime={isTauriRuntime}
      />
      <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
        <DialogContent showCloseButton={!moveBusy}>
          <DialogHeader>
            <DialogTitle>Move agent to workspace</DialogTitle>
          </DialogHeader>
          <p className="text-text-3 text-sm leading-relaxed">
            Saves this thread under the workspace you pick. After moving, file
            tools, @ mentions, and the document canvas apply to that folder.
          </p>
          <label className="flex flex-col gap-1.5">
            <span className="text-text-2 text-xs font-medium">Workspace</span>
            <select
              className="border-border bg-background text-text-1 focus-visible:ring-ring h-9 w-full rounded-md border px-2 text-sm shadow-sm focus-visible:ring-2 focus-visible:outline-none"
              value={moveTargetWs}
              disabled={moveBusy}
              onChange={(e) => setMoveTargetWs(e.target.value)}
            >
              {workspaces.map((w) => (
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
                documentLiveSessionKey={
                  isProfileSession || isDetachedSession ? undefined : sessionKey
                }
                onCanvasSelectionAsk={
                  isProfileSession || isDetachedSession
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
