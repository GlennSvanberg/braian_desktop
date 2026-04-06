import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  Copy,
  FolderOpen,
  FolderPlus,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import { revealItemInDir } from '@tauri-apps/plugin-opener'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import { formatPathForDisplay } from '@/lib/workspace-path-utils'
import { cn } from '@/lib/utils'

import { useWorkspace } from './workspace-context'

type Props = {
  workspaceId: string
  className?: string
}

export function WorkspaceFolderManagementPanel({
  workspaceId,
  className,
}: Props) {
  const navigate = useNavigate()
  const {
    workspaces,
    activeWorkspace,
    setActiveWorkspaceId,
    refreshWorkspaces,
    isTauriRuntime,
    defaultWorkspacesRoot,
  } = useWorkspace()

  const workspace =
    workspaces.find((w) => w.id === workspaceId) ?? activeWorkspace

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
        title:
          'Choose parent folder (a new folder for this workspace will be created inside)',
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
      navigate({ to: '/dashboard', search: { tab: 'overview' } })
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
      navigate({ to: '/dashboard', search: { tab: 'overview' } })
    })
  }

  const onOpenInExplorer = () => {
    if (!workspace?.rootPath) return
    void revealItemInDir(workspace.rootPath).catch((e) => console.error(e))
  }

  const onRemove = () => {
    if (!workspace) return
    if (
      !window.confirm(
        `Remove “${workspace.name}” from braian.io? Files on disk stay; only the app link is removed.`,
      )
    ) {
      return
    }
    void run(async () => {
      await workspaceRemove(workspace.id)
      await refreshWorkspaces()
      navigate({ to: '/dashboard', search: { tab: 'overview' } })
    })
  }

  const openEditWorkspace = () => {
    if (!workspace) return
    setEditName(workspace.name)
    setEditOpen(true)
  }

  const onEditSave = () => {
    if (!workspace) return
    const t = editName.trim()
    if (!t) return
    void run(async () => {
      if (t !== workspace.name) {
        await workspaceRename(workspace.id, t)
        await refreshWorkspaces()
      }
      setEditOpen(false)
    })
  }

  const onCopyPath = async () => {
    const p = workspace?.rootPath
    if (!p) return
    const display = formatPathForDisplay(p)
    try {
      await navigator.clipboard.writeText(display)
    } catch {
      window.prompt('Copy this path:', display)
    }
  }

  return (
    <>
      <section
        className={cn(
          'border-border bg-card rounded-xl border p-4 shadow-sm md:p-5',
          className,
        )}
      >
        <h2 className="text-text-2 mb-1 text-xs font-semibold tracking-wide uppercase">
          Workspace folder
        </h2>
        {workspace ? (
          <p className="text-text-1 mb-3 truncate text-sm font-semibold">
            {workspace.name}
          </p>
        ) : (
          <p className="text-text-3 mb-3 text-sm">No workspace selected.</p>
        )}

        {isTauriRuntime && workspace?.rootPath ? (
          <div className="mb-4 flex items-start gap-1">
            <p
              className="text-text-3 max-h-24 min-w-0 flex-1 overflow-y-auto break-all font-mono text-[11px] leading-snug"
              title={formatPathForDisplay(workspace.rootPath)}
            >
              {formatPathForDisplay(workspace.rootPath)}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="text-text-3 size-7 shrink-0"
              disabled={busy}
              aria-label="Copy folder path"
              title="Copy path"
              onClick={() => void onCopyPath()}
            >
              <Copy className="size-3.5" aria-hidden />
            </Button>
          </div>
        ) : isTauriRuntime && workspace ? (
          <p className="text-text-3 mb-4 text-xs leading-snug">
            No folder is linked to this workspace.
          </p>
        ) : !isTauriRuntime ? (
          <p className="text-text-3 mb-4 text-xs leading-snug">
            Open the desktop app to add folder workspaces on this computer. Folder
            paths are shown there.
          </p>
        ) : null}

        {isTauriRuntime && workspaces.length === 0 ? (
          <p className="text-text-3 mb-3 text-xs leading-snug">
            No folders yet—create or add one below.
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {isTauriRuntime ? (
            <>
              <Button
                type="button"
                variant="default"
                size="sm"
                className="gap-1.5"
                disabled={busy}
                onClick={() => setCreateOpen(true)}
              >
                <Plus className="size-3.5" aria-hidden />
                New workspace
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={busy}
                onClick={() => void onAddFolder()}
              >
                <FolderPlus className="size-3.5" aria-hidden />
                Open existing folder
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={busy || !workspace?.rootPath}
                onClick={() => void onOpenInExplorer()}
              >
                <FolderOpen className="size-3.5" aria-hidden />
                Show in file manager
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={busy || !workspace}
                onClick={() => openEditWorkspace()}
              >
                <Pencil className="size-3.5" aria-hidden />
                Edit name…
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive gap-1.5"
                disabled={busy || !workspace}
                onClick={() => void onRemove()}
              >
                <Trash2 className="size-3.5" aria-hidden />
                Remove from app
              </Button>
            </>
          ) : null}
        </div>
      </section>

      <Sheet open={createOpen} onOpenChange={onCreateSheetOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>New workspace</SheetTitle>
            <SheetDescription>
              Pick where the workspace folder should live. The default parent is
              your braian.io app workspaces directory; use Browse to put it
              anywhere. A new subfolder is created from the workspace name (safe
              characters). The display name in the app can differ from the folder
              name.
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
            {workspace?.rootPath ? (
              <div className="flex flex-col gap-2">
                <p className="text-text-2 text-xs font-medium">Folder</p>
                <p className="text-text-3 bg-muted/40 max-h-32 overflow-y-auto rounded-md border border-border px-2 py-2 font-mono text-[11px] leading-snug break-all">
                  {formatPathForDisplay(workspace.rootPath)}
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
