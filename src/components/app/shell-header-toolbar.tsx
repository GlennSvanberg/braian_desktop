import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

type ShellHeaderToolbarContextValue = {
  toolbar: ReactNode | null
  setToolbar: (node: ReactNode | null) => void
}

const ShellHeaderToolbarContext =
  createContext<ShellHeaderToolbarContextValue | null>(null)

export function ShellHeaderToolbarProvider({
  children,
}: {
  children: ReactNode
}) {
  const [toolbar, setToolbarState] = useState<ReactNode | null>(null)
  const setToolbar = useCallback((node: ReactNode | null) => {
    setToolbarState(node)
  }, [])
  const value = useMemo(
    () => ({ toolbar, setToolbar }),
    [toolbar, setToolbar],
  )
  return (
    <ShellHeaderToolbarContext.Provider value={value}>
      {children}
    </ShellHeaderToolbarContext.Provider>
  )
}

export function useShellHeaderToolbar() {
  const ctx = useContext(ShellHeaderToolbarContext)
  if (!ctx) {
    throw new Error(
      'useShellHeaderToolbar must be used within ShellHeaderToolbarProvider',
    )
  }
  return ctx
}

export function useOptionalShellHeaderToolbar(): ShellHeaderToolbarContextValue | null {
  return useContext(ShellHeaderToolbarContext)
}
