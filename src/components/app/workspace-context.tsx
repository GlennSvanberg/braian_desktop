import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import { MOCK_WORKSPACES, type MockWorkspace } from '@/lib/mock-workspace-data'

type WorkspaceContextValue = {
  activeWorkspaceId: string
  setActiveWorkspaceId: (id: string) => void
  activeWorkspace: MockWorkspace
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(
    MOCK_WORKSPACES[0].id,
  )

  const activeWorkspace = useMemo(() => {
    return (
      MOCK_WORKSPACES.find((w) => w.id === activeWorkspaceId) ??
      MOCK_WORKSPACES[0]
    )
  }, [activeWorkspaceId])

  const value = useMemo(
    () => ({
      activeWorkspaceId,
      setActiveWorkspaceId,
      activeWorkspace,
    }),
    [activeWorkspace, activeWorkspaceId],
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
