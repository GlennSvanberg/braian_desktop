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
import { CLOUD_WORKSPACE_SESSION_ID } from '@/lib/cloud/workspace'
import { isTauri } from '@/lib/tauri-env'
import {
  type ConversationDto,
  type WorkspaceDto,
  conversationList,
  workspaceGetDefaultRoot,
  workspaceList,
  workspaceTouch,
} from '@/lib/workspace-api'

import { CloudArrowAppsWorkspaceSync } from './cloud-arrow-apps-workspace-sync'
import { CloudConversationsSync } from './cloud-conversations-sync'

const ACTIVE_WS_KEY = 'braian.io.activeWorkspaceId'
const FILE_EXPLORER_OPEN_BY_WS_KEY = 'braian.io.fileExplorerOpenByWorkspace'

function readFileExplorerOpenForWorkspace(workspaceId: string): boolean {
  if (!workspaceId || typeof localStorage === 'undefined') return false
  try {
    const raw = localStorage.getItem(FILE_EXPLORER_OPEN_BY_WS_KEY)
    if (!raw) return false
    const map = JSON.parse(raw) as Record<string, unknown>
    return map[workspaceId] === true
  } catch {
    return false
  }
}

function persistFileExplorerOpenForWorkspace(
  workspaceId: string,
  open: boolean,
): void {
  if (!workspaceId || typeof localStorage === 'undefined') return
  try {
    const raw = localStorage.getItem(FILE_EXPLORER_OPEN_BY_WS_KEY)
    const map: Record<string, boolean> = raw ? JSON.parse(raw) : {}
    map[workspaceId] = open
    localStorage.setItem(
      FILE_EXPLORER_OPEN_BY_WS_KEY,
      JSON.stringify(map),
    )
  } catch {
    // ignore quota / JSON errors
  }
}

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
  fileTreeOpen: boolean
  setFileTreeOpen: (open: boolean) => void
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
  const [fileTreeOpen, setFileTreeOpenState] = useState(false)
  const isTauriRuntime = isTauri()

  useEffect(() => {
    if (!activeWorkspaceId) {
      setFileTreeOpenState(false)
      return
    }
    setFileTreeOpenState(readFileExplorerOpenForWorkspace(activeWorkspaceId))
  }, [activeWorkspaceId])

  const setFileTreeOpen = useCallback((open: boolean) => {
    setFileTreeOpenState(open)
    persistFileExplorerOpenForWorkspace(activeWorkspaceId, open)
  }, [activeWorkspaceId])

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
      setConversationsByWorkspace((prev) => {
        const cloud = prev[CLOUD_WORKSPACE_SESSION_ID]
        const next: Record<string, WorkspaceConversation[]> = {}
        if (cloud) next[CLOUD_WORKSPACE_SESSION_ID] = cloud
        return next
      })
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
    setConversationsByWorkspace((prev) => {
      const next: Record<string, WorkspaceConversation[]> =
        Object.fromEntries(results)
      const cloud = prev[CLOUD_WORKSPACE_SESSION_ID]
      if (cloud) next[CLOUD_WORKSPACE_SESSION_ID] = cloud
      return next
    })
  }, [workspaces])

  const handleCloudList = useCallback(async (rows: WorkspaceConversation[]) => {
    const { formatUpdatedLabel } = await import('@/lib/format-updated')
    const decorated = rows.map((r) => ({
      ...r,
      updatedLabel: formatUpdatedLabel(r.updatedAtMs),
    }))
    setConversationsByWorkspace((prev) => {
      if (decorated.length === 0) {
        if (!prev[CLOUD_WORKSPACE_SESSION_ID]) return prev
        const next = { ...prev }
        delete next[CLOUD_WORKSPACE_SESSION_ID]
        return next
      }
      return { ...prev, [CLOUD_WORKSPACE_SESSION_ID]: decorated }
    })
  }, [])

  const handleCloudListSync = useCallback(
    (rows: WorkspaceConversation[]) => {
      void handleCloudList(rows)
    },
    [handleCloudList],
  )

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
      fileTreeOpen,
      setFileTreeOpen,
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
      fileTreeOpen,
      setFileTreeOpen,
      loading,
      isTauriRuntime,
    ],
  )

  return (
    <WorkspaceContext.Provider value={value}>
      <CloudConversationsSync onCloudList={handleCloudListSync} />
      <CloudArrowAppsWorkspaceSync activeWorkspaceId={activeWorkspaceId} />
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
