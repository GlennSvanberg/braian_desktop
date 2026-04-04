import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  ChevronsUpDown,
  Copy,
  FolderOpen,
  FolderPlus,
  GalleryVerticalEnd,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import { revealItemInDir } from '@tauri-apps/plugin-opener'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  pickFolder,
  workspaceAddFromPath,
  workspaceCreate,
  workspaceRemove,
  workspaceRename,
} from '@/lib/workspace-api'

import { useWorkspace } from './workspace-context'

export function WorkspaceSwitcher() {
  const { isMobile } = useSidebar()
  const navigate = useNavigate()
  const {
    workspaces,
    activeWorkspace,
    setActiveWorkspaceId,
    refreshWorkspaces,
    isTauriRuntime,
    defaultWorkspacesRoot,
  } = useWorkspace()

  const [createOpen, setCreateOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [editName, setEditName] = useState('')
  const [createParentPath, setCreateParentPath] = useState('')
  const [busy, setBusy] = useState(false)

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      console.error(e)
      const msg = e instanceof Error ? e.message : String(e)
      window.alert(msg)
    } finally {
      setBusy(false)
    }
  }

  const onCreateSheetOpenChange = (open: boolean) => {
    setCreateOpen(open)
    if (open) {
      setNewName('')
      setCreateParentPath(defaultWorkspacesRoot ?? '')
    }
  }

  useEffect(() => {
    if (!createOpen || createParentPath || !defaultWorkspacesRoot) return
    setCreateParentPath(defaultWorkspacesRoot)
  }, [createOpen, createParentPath, defaultWorkspacesRoot])

  const onChooseCreateParent = () => {
    void run(async () => {
      const path = await pickFolder({
        title: 'Choose parent folder (a new folder for this workspace will be created inside)',
        defaultPath: createParentPath || defaultWorkspacesRoot || undefined,
      })
      if (path) setCreateParentPath(path)
    })
  }

  const onCreateSubmit = () => {
    const n = newName.trim()
    const parent = createParentPath.trim()
    if (!n || !parent) return
    void run(async () => {
      const ws = await workspaceCreate(parent, n)
      setNewName('')
      setCreateOpen(false)
      await refreshWorkspaces()
      setActiveWorkspaceId(ws.id)
      navigate({ to: '/dashboard' })
    })
  }

  const onAddFolder = () => {
    void run(async () => {
      const path = await pickFolder({
        title: 'Select a folder to use as a workspace',
        defaultPath: defaultWorkspacesRoot ?? undefined,
      })
      if (!path) return
      const ws = await workspaceAddFromPath(path)
      await refreshWorkspaces()
      setActiveWorkspaceId(ws.id)
      navigate({ to: '/dashboard' })
    })
  }

  const onOpenInExplorer = () => {
    if (!activeWorkspace?.rootPath) return
    void revealItemInDir(activeWorkspace.rootPath).catch((e) =>
      console.error(e),
    )
  }

  const onRemove = () => {
    if (!activeWorkspace) return
    if (
      !window.confirm(
        `Remove “${activeWorkspace.name}” from braian.io? Files on disk stay; only the app link is removed.`,
      )
    ) {
      return
    }
    void run(async () => {
      await workspaceRemove(activeWorkspace.id)
      await refreshWorkspaces()
      navigate({ to: '/dashboard' })
    })
  }

  const openEditWorkspace = () => {
    if (!activeWorkspace) return
    setEditName(activeWorkspace.name)
    setEditOpen(true)
  }

  const onEditSave = () => {
    if (!activeWorkspace) return
    const t = editName.trim()
    if (!t) return
    void run(async () => {
      if (t !== activeWorkspace.name) {
        await workspaceRename(activeWorkspace.id, t)
        await refreshWorkspaces()
      }
      setEditOpen(false)
    })
  }

  const onCopyPath = async () => {
    const p = activeWorkspace?.rootPath
    if (!p) return
    try {
      await navigator.clipboard.writeText(p)
    } catch {
      window.prompt('Copy this path:', p)
    }
  }

  const triggerSubtitle = !activeWorkspace
    ? 'No workspace'
    : isTauriRuntime && activeWorkspace.rootPath
      ? 'On this computer'
      : 'Preview'

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton
                size="lg"
                disabled={busy}
                className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              >
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  {busy ? (
                    <Loader2 className="size-4 shrink-0 animate-spin" />
                  ) : (
                    <GalleryVerticalEnd className="size-4 shrink-0" />
                  )}
                </div>
                <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">
                    {activeWorkspace?.name ?? 'No workspace'}
                  </span>
                  <span className="text-sidebar-foreground/65 truncate text-xs">
                    {triggerSubtitle}
                  </span>
                </div>
                <ChevronsUpDown className="ml-auto shrink-0 opacity-50" />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-56 rounded-lg"
              align="start"
              side={isMobile ? 'bottom' : 'right'}
              sideOffset={4}
            >
              <DropdownMenuLabel className="text-text-3 text-xs font-normal">
                Switch workspace
              </DropdownMenuLabel>
              {workspaces.length === 0 ? (
                <p className="text-text-3 px-2 py-2 text-xs">
                  {isTauriRuntime
                    ? 'Create or add a folder to get started.'
                    : 'Open the desktop app for folder workspaces.'}
                </p>
              ) : (
                workspaces.map((ws) => (
                  <DropdownMenuItem
                    key={ws.id}
                    onClick={() => {
                      setActiveWorkspaceId(ws.id)
                      navigate({ to: '/dashboard' })
                    }}
                    className="cursor-pointer gap-2 p-2"
                  >
                    <div className="flex size-6 items-center justify-center rounded-md border border-border bg-muted">
                      <GalleryVerticalEnd className="size-3.5 shrink-0 opacity-70" />
                    </div>
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate font-medium">{ws.name}</span>
                      <span className="text-text-3 truncate text-xs">
                        {isTauriRuntime && ws.rootPath
                          ? 'On this computer'
                          : 'Browser preview'}
                      </span>
                    </div>
                  </DropdownMenuItem>
                ))
              )}
              <DropdownMenuSeparator />
              {isTauriRuntime ? (
                <>
                  <DropdownMenuItem
                    className="cursor-pointer gap-2 p-2"
                    onClick={() => setCreateOpen(true)}
                  >
                    <Plus className="size-4" />
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium">New workspace</span>
                      <span className="text-text-3 text-xs">
                        New folder—default location or choose elsewhere
                      </span>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="cursor-pointer gap-2 p-2"
                    onClick={() => void onAddFolder()}
                  >
                    <FolderPlus className="size-4" />
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium">Open existing folder</span>
                      <span className="text-text-3 text-xs">
                        Use any folder on disk as a workspace
                      </span>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="cursor-pointer gap-2 p-2"
                    disabled={!activeWorkspace?.rootPath}
                    onClick={() => void onOpenInExplorer()}
                  >
                    <FolderOpen className="size-4" />
                    <span>Show in file manager</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="cursor-pointer gap-2 p-2"
                    disabled={!activeWorkspace}
                    onClick={() => openEditWorkspace()}
                  >
                    <Pencil className="size-4" />
                    <span>Edit workspace…</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive cursor-pointer gap-2 p-2"
                    disabled={!activeWorkspace}
                    onClick={() => void onRemove()}
                  >
                    <Trash2 className="size-4" />
                    <span>Remove from app</span>
                  </DropdownMenuItem>
                </>
              ) : (
                <DropdownMenuItem disabled className="text-text-3 gap-2 p-2">
                  <span>Folder actions need the desktop app</span>
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>

      <Sheet open={createOpen} onOpenChange={onCreateSheetOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>New workspace</SheetTitle>
            <SheetDescription>
              Pick where the workspace folder should live. The default parent
              is your braian.io app workspaces directory; use Browse to put it
              anywhere. A new subfolder is created from the workspace name (safe
              characters). The display name in the app can differ from the
              folder name.
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-4 px-4">
            <div className="flex flex-col gap-2">
              <p className="text-text-2 text-xs font-medium">Parent folder</p>
              <p
                className="text-text-3 bg-muted/40 max-h-24 overflow-y-auto rounded-md border border-border px-2 py-2 font-mono text-[11px] leading-snug break-all"
                title={createParentPath || undefined}
              >
                {createParentPath ||
                  (defaultWorkspacesRoot
                    ? 'Loading default location…'
                    : 'Use Browse to choose a parent folder')}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full sm:w-auto"
                disabled={busy}
                onClick={() => void onChooseCreateParent()}
              >
                Browse…
              </Button>
            </div>
            <div className="flex flex-col gap-2">
              <p className="text-text-2 text-xs font-medium">Workspace name</p>
              <Input
                placeholder="e.g. Acme redesign"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onCreateSubmit()
                }}
              />
            </div>
          </div>
          <SheetFooter className="flex-row justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onCreateSheetOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!newName.trim() || !createParentPath.trim() || busy}
              onClick={() => void onCreateSubmit()}
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                'Create'
              )}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <Sheet open={editOpen} onOpenChange={setEditOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Edit workspace</SheetTitle>
            <SheetDescription>
              Change how this workspace appears in the app. The folder on disk
              stays the same unless you move it in the file manager.
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-4 px-4">
            <div className="flex flex-col gap-2">
              <p className="text-text-2 text-xs font-medium">Name</p>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onEditSave()
                }}
              />
            </div>
            {activeWorkspace?.rootPath ? (
              <div className="flex flex-col gap-2">
                <p className="text-text-2 text-xs font-medium">Folder</p>
                <p className="text-text-3 bg-muted/40 max-h-32 overflow-y-auto rounded-md border border-border px-2 py-2 font-mono text-[11px] leading-snug break-all">
                  {activeWorkspace.rootPath}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => void onCopyPath()}
                  >
                    <Copy className="size-3.5" />
                    Copy path
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => void onOpenInExplorer()}
                  >
                    <FolderOpen className="size-3.5" />
                    Show in file manager
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-text-3 text-xs">
                Folder path is only available in the desktop app.
              </p>
            )}
          </div>
          <SheetFooter className="flex-row justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!editName.trim() || busy}
              onClick={() => void onEditSave()}
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                'Save'
              )}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  )
}
