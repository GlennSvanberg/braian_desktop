import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import { isTauri } from '@/lib/tauri-env'
import {
  type ConversationDto,
  type WorkspaceDto,
  conversationList,
  workspaceGetDefaultRoot,
  workspaceList,
} from '@/lib/workspace-api'

const ACTIVE_WS_KEY = 'braian.io.activeWorkspaceId'

export type WorkspaceConversation = ConversationDto & {
  updatedLabel: string
}

type WorkspaceContextValue = {
  workspaces: WorkspaceDto[]
  activeWorkspaceId: string
  activeWorkspace: WorkspaceDto | null
  setActiveWorkspaceId: (id: string) => void
  refreshWorkspaces: () => Promise<void>
  conversations: WorkspaceConversation[]
  refreshConversations: () => Promise<void>
  createConversation: () => Promise<string>
  defaultWorkspacesRoot: string | null
  loading: boolean
  isTauriRuntime: boolean
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspaces, setWorkspaces] = useState<WorkspaceDto[]>([])
  const [activeWorkspaceId, setActiveWorkspaceIdState] = useState('')
  const [conversations, setConversations] = useState<WorkspaceConversation[]>(
    [],
  )
  const [defaultWorkspacesRoot, setDefaultWorkspacesRoot] = useState<
    string | null
  >(null)
  const [loading, setLoading] = useState(true)
  const isTauriRuntime = isTauri()

  const refreshWorkspaces = useCallback(async () => {
    setLoading(true)
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
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshWorkspaces()
  }, [refreshWorkspaces])

  useEffect(() => {
    void workspaceGetDefaultRoot().then(setDefaultWorkspacesRoot)
  }, [])

  const setActiveWorkspaceId = useCallback((id: string) => {
    setActiveWorkspaceIdState(id)
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(ACTIVE_WS_KEY, id)
    }
  }, [])

  const activeWorkspace = useMemo(() => {
    return workspaces.find((w) => w.id === activeWorkspaceId) ?? null
  }, [workspaces, activeWorkspaceId])

  const refreshConversations = useCallback(async () => {
    if (!activeWorkspaceId) {
      setConversations([])
      return
    }
    const { formatUpdatedLabel } = await import('@/lib/format-updated')
    const rows = await conversationList(activeWorkspaceId)
    setConversations(
      rows.map((c) => ({
        ...c,
        updatedLabel: formatUpdatedLabel(c.updatedAtMs),
      })),
    )
  }, [activeWorkspaceId])

  useEffect(() => {
    void refreshConversations()
  }, [refreshConversations])

  const createConversation = useCallback(async () => {
    const { conversationCreate } = await import('@/lib/workspace-api')
    if (!activeWorkspaceId) {
      throw new Error('No workspace selected.')
    }
    const c = await conversationCreate(activeWorkspaceId)
    await refreshConversations()
    return c.id
  }, [activeWorkspaceId, refreshConversations])

  const value = useMemo(
    () => ({
      workspaces,
      activeWorkspaceId,
      activeWorkspace,
      setActiveWorkspaceId,
      refreshWorkspaces,
      conversations,
      refreshConversations,
      createConversation,
      defaultWorkspacesRoot,
      loading,
      isTauriRuntime,
    }),
    [
      workspaces,
      activeWorkspaceId,
      activeWorkspace,
      setActiveWorkspaceId,
      refreshWorkspaces,
      conversations,
      refreshConversations,
      createConversation,
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
