import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import {
  registerConversationListRefresh,
  unregisterConversationListRefresh,
} from '@/lib/conversation-list-refresh'
import { isPersonalWorkspaceSessionId } from '@/lib/chat-sessions/detached'
import { isTauri } from '@/lib/tauri-env'
import {
  type ConversationDto,
  type WorkspaceDto,
  conversationList,
  workspaceGetDefaultRoot,
  workspaceList,
  workspaceTouch,
} from '@/lib/workspace-api'

const ACTIVE_WS_KEY = 'braian.io.activeWorkspaceId'

export type WorkspaceConversation = ConversationDto & {
  updatedLabel: string
}

type WorkspaceContextValue = {
  workspaces: WorkspaceDto[]
  /** Folder workspaces only (excludes built-in Simple chats). */
  projectWorkspaces: WorkspaceDto[]
  /** Built-in simple chats workspace, if present in `workspaces`. */
  personalWorkspace: WorkspaceDto | null
  activeWorkspaceId: string
  activeWorkspace: WorkspaceDto | null
  setActiveWorkspaceId: (id: string) => void
  refreshWorkspaces: (opts?: { silent?: boolean }) => Promise<void>
  conversations: WorkspaceConversation[]
  conversationsByWorkspace: Record<string, WorkspaceConversation[]>
  refreshConversations: () => Promise<void>
  refreshConversationLists: () => Promise<void>
  /** Refetch one workspace’s threads (faster than refreshConversations). */
  refreshConversationsForWorkspace: (workspaceId: string) => Promise<void>
  /** Instant sidebar update; pair with API + refresh or rollback on error. */
  optimisticSetConversationPinned: (input: {
    workspaceId: string
    conversationId: string
    pinned: boolean
  }) => void
  createConversation: () => Promise<string>
  createConversationInWorkspace: (workspaceId: string) => Promise<string>
  defaultWorkspacesRoot: string | null
  loading: boolean
  isTauriRuntime: boolean
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspaces, setWorkspaces] = useState<WorkspaceDto[]>([])
  const [activeWorkspaceId, setActiveWorkspaceIdState] = useState('')
  const [conversationsByWorkspace, setConversationsByWorkspace] = useState<
    Record<string, WorkspaceConversation[]>
  >({})
  const [defaultWorkspacesRoot, setDefaultWorkspacesRoot] = useState<
    string | null
  >(null)
  const [loading, setLoading] = useState(true)
  const isTauriRuntime = isTauri()

  const refreshWorkspaces = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true)
    try {
      const list = await workspaceList()
      setWorkspaces(list)
      setActiveWorkspaceIdState((prev) => {
        const fromStorage =
          typeof localStorage !== 'undefined'
            ? localStorage.getItem(ACTIVE_WS_KEY)
            : null
        const candidate = list.some((w) => w.id === prev)
          ? prev
          : fromStorage && list.some((w) => w.id === fromStorage)
            ? fromStorage
            : (list[0]?.id ?? '')
        if (candidate && typeof localStorage !== 'undefined') {
          localStorage.setItem(ACTIVE_WS_KEY, candidate)
        }
        return candidate
      })
    } finally {
      if (!opts?.silent) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshWorkspaces()
  }, [refreshWorkspaces])

  useEffect(() => {
    void workspaceGetDefaultRoot().then(setDefaultWorkspacesRoot)
  }, [])

  const refreshConversationLists = useCallback(async () => {
    const ids = workspaces.map((w) => w.id)
    if (ids.length === 0) {
      setConversationsByWorkspace({})
      return
    }
    const { formatUpdatedLabel } = await import('@/lib/format-updated')
    const results = await Promise.all(
      ids.map(async (wid) => {
        const rows = await conversationList(wid)
        return [
          wid,
          rows.map((c) => ({
            ...c,
            updatedLabel: formatUpdatedLabel(c.updatedAtMs),
          })),
        ] as const
      }),
    )
    setConversationsByWorkspace(Object.fromEntries(results))
  }, [workspaces])

  useEffect(() => {
    void refreshConversationLists()
  }, [refreshConversationLists])

  const refreshConversationsForWorkspace = useCallback(
    async (workspaceId: string) => {
      const { formatUpdatedLabel } = await import('@/lib/format-updated')
      const rows = await conversationList(workspaceId)
      setConversationsByWorkspace((prev) => ({
        ...prev,
        [workspaceId]: rows.map((c) => ({
          ...c,
          updatedLabel: formatUpdatedLabel(c.updatedAtMs),
        })),
      }))
    },
    [],
  )

  const refreshConversations = useCallback(async () => {
    await refreshConversationLists()
  }, [refreshConversationLists])

  const optimisticSetConversationPinned = useCallback(
    (input: {
      workspaceId: string
      conversationId: string
      pinned: boolean
    }) => {
      setConversationsByWorkspace((prev) => {
        const list = prev[input.workspaceId]
        if (!list) return prev
        const next = list.map((c) =>
          c.id === input.conversationId ? { ...c, pinned: input.pinned } : c,
        )
        next.sort((a, b) => {
          if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
          return b.updatedAtMs - a.updatedAtMs
        })
        return { ...prev, [input.workspaceId]: next }
      })
    },
    [],
  )

  useEffect(() => {
    registerConversationListRefresh(refreshConversations)
    return () => {
      unregisterConversationListRefresh()
    }
  }, [refreshConversations])

  const setActiveWorkspaceId = useCallback(
    (id: string) => {
      setActiveWorkspaceIdState(id)
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(ACTIVE_WS_KEY, id)
      }
      const now = Date.now()
      if (isTauriRuntime) {
        void workspaceTouch(id).catch((e) => console.error(e))
      }
      setWorkspaces((prev) => {
        const w = prev.find((x) => x.id === id)
        if (!w) return prev
        const updated: WorkspaceDto = { ...w, lastUsedAtMs: now }
        const rest = prev.filter((x) => x.id !== id)
        return [...rest, updated].sort(
          (a, b) =>
            b.lastUsedAtMs - a.lastUsedAtMs ||
            a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
        )
      })
    },
    [isTauriRuntime],
  )

  const projectWorkspaces = useMemo(
    () => workspaces.filter((w) => !isPersonalWorkspaceSessionId(w.id)),
    [workspaces],
  )

  const personalWorkspace = useMemo(
    () => workspaces.find((w) => isPersonalWorkspaceSessionId(w.id)) ?? null,
    [workspaces],
  )

  const activeWorkspace = useMemo(() => {
    return workspaces.find((w) => w.id === activeWorkspaceId) ?? null
  }, [workspaces, activeWorkspaceId])

  const conversations = useMemo(
    () => conversationsByWorkspace[activeWorkspaceId] ?? [],
    [conversationsByWorkspace, activeWorkspaceId],
  )

  const createConversationInWorkspace = useCallback(
    async (workspaceId: string) => {
      const { conversationCreate } = await import('@/lib/workspace-api')
      const c = await conversationCreate(workspaceId)
      await refreshConversationsForWorkspace(workspaceId)
      return c.id
    },
    [refreshConversationsForWorkspace],
  )

  const createConversation = useCallback(async () => {
    if (!activeWorkspaceId) {
      throw new Error('No workspace selected.')
    }
    return createConversationInWorkspace(activeWorkspaceId)
  }, [activeWorkspaceId, createConversationInWorkspace])

  const value = useMemo(
    () => ({
      workspaces,
      projectWorkspaces,
      personalWorkspace,
      activeWorkspaceId,
      activeWorkspace,
      setActiveWorkspaceId,
      refreshWorkspaces,
      conversations,
      conversationsByWorkspace,
      refreshConversations,
      refreshConversationLists,
      refreshConversationsForWorkspace,
      optimisticSetConversationPinned,
      createConversation,
      createConversationInWorkspace,
      defaultWorkspacesRoot,
      loading,
      isTauriRuntime,
    }),
    [
      workspaces,
      projectWorkspaces,
      personalWorkspace,
      activeWorkspaceId,
      activeWorkspace,
      setActiveWorkspaceId,
      refreshWorkspaces,
      conversations,
      conversationsByWorkspace,
      refreshConversations,
      refreshConversationLists,
      refreshConversationsForWorkspace,
      optimisticSetConversationPinned,
      createConversation,
      createConversationInWorkspace,
      defaultWorkspacesRoot,
      loading,
      isTauriRuntime,
    ],
  )

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  )
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) {
    throw new Error('useWorkspace must be used within WorkspaceProvider')
  }
  return ctx
}
