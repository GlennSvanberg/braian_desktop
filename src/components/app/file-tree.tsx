import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  File,
  Folder,
  ChevronRight,
  ChevronDown,
  FileText,
  FileCode,
  FileImage,
  FileArchive,
  Loader2,
  PanelLeftClose,
  FolderPlus,
} from 'lucide-react'
import { openPath } from '@tauri-apps/plugin-opener'

import { useWorkspace } from './workspace-context'
import {
  workspaceListDir,
  workspaceMoveEntry,
  workspaceRenameEntry,
  workspaceCreateDir,
  workspaceDeleteEntry,
  type WorkspaceDirEntryDto,
} from '@/lib/workspace-api'
import {
  registerWorkspaceExplorerMoveHandler,
  workspaceFilePointerDragMaybeStartOnPointerDown,
} from '@/lib/workspace-file-pointer-dnd'
import {
  isPathUnderRoot,
  joinRootRelative,
  parentDirectoryOfRelativePath,
} from '@/lib/workspace-path-utils'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface FileTreeItemProps {
  item: WorkspaceDirEntryDto
  depth: number
  workspaceId: string
  rootPath: string
  treeRefreshKey: number
  onStructureChanged: () => void
}

const FileIcon = ({ name, isDir }: { name: string; isDir: boolean }) => {
  if (isDir)
    return (
      <Folder className="size-4 shrink-0 text-accent-600/85 dark:text-accent-500/85" />
    )

  const ext = name.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'md':
    case 'txt':
    case 'pdf':
      return <FileText className="size-4 shrink-0 text-muted-foreground" />
    case 'ts':
    case 'tsx':
    case 'js':
    case 'jsx':
    case 'rs':
    case 'py':
    case 'go':
    case 'json':
    case 'html':
    case 'css':
      return <FileCode className="size-4 shrink-0 text-blue-400" />
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
    case 'webp':
      return <FileImage className="size-4 shrink-0 text-purple-400" />
    case 'zip':
    case 'tar':
    case 'gz':
    case 'rar':
      return <FileArchive className="size-4 shrink-0 text-orange-400" />
    default:
      return <File className="size-4 shrink-0 text-muted-foreground" />
  }
}

type RowMenuState = { x: number; y: number } | null

const FileTreeItem = ({
  item,
  depth,
  workspaceId,
  rootPath,
  treeRefreshKey,
  onStructureChanged,
}: FileTreeItemProps) => {
  const [isOpen, setIsOpen] = useState(false)
  const [children, setChildren] = useState<WorkspaceDirEntryDto[]>([])
  const [loading, setLoading] = useState(false)
  const [rowMenu, setRowMenu] = useState<RowMenuState>(null)
  const [renaming, setRenaming] = useState(false)
  const [renameDraft, setRenameDraft] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)
  const ignoreRenameBlurRef = useRef(false)

  useEffect(() => {
    if (!rowMenu) return
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return
      setRowMenu(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setRowMenu(null)
    }
    const id = requestAnimationFrame(() => {
      window.addEventListener('pointerdown', onPointerDown, true)
    })
    window.addEventListener('keydown', onKey, true)
    return () => {
      cancelAnimationFrame(id)
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [rowMenu])

  const toggleFolder = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (!item.isDir) return

      const nextOpen = !isOpen
      setIsOpen(nextOpen)

      if (nextOpen && children.length === 0) {
        setLoading(true)
        try {
          const result = await workspaceListDir(workspaceId, item.relativePath)
          setChildren(result)
        } catch (err) {
          console.error('Failed to list directory:', err)
        } finally {
          setLoading(false)
        }
      }
    },
    [item.isDir, item.relativePath, isOpen, children.length, workspaceId],
  )

  const onFolderClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.detail === 2) return
      void toggleFolder(e)
    },
    [toggleFolder],
  )

  const openInOs = useCallback(() => {
    const absolutePath = joinRootRelative(rootPath, item.relativePath)
    if (!isPathUnderRoot(absolutePath, rootPath)) {
      window.alert('Path is outside the workspace.')
      return
    }
    // Defer past context-menu unmount / WebView focus quirks (same path shape as chat file chips).
    queueMicrotask(() => {
      void openPath(absolutePath).catch((err) => {
        console.error('Failed to open path:', err)
        window.alert(err instanceof Error ? err.message : String(err))
      })
    })
  }, [item.relativePath, rootPath])

  const onRowContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setRowMenu({ x: e.clientX, y: e.clientY })
  }, [])

  const startRename = useCallback(() => {
    setRowMenu(null)
    setRenameDraft(item.name)
    setRenaming(true)
  }, [item.name])

  const cancelRename = useCallback(() => {
    setRenaming(false)
    setRenameDraft('')
  }, [])

  const submitRename = useCallback(async () => {
    const next = renameDraft.trim()
    if (!next || next === item.name) {
      cancelRename()
      return
    }
    try {
      await workspaceRenameEntry(workspaceId, item.relativePath, next)
      onStructureChanged()
    } catch (err) {
      console.error(err)
      window.alert(err instanceof Error ? err.message : String(err))
    } finally {
      cancelRename()
    }
  }, [
    renameDraft,
    item.name,
    item.relativePath,
    workspaceId,
    onStructureChanged,
    cancelRename,
  ])

  const onRenameBlur = useCallback(() => {
    if (ignoreRenameBlurRef.current) {
      ignoreRenameBlurRef.current = false
      return
    }
    void submitRename()
  }, [submitRename])

  const deleteEntry = useCallback(async () => {
    setRowMenu(null)
    const kind = item.isDir ? 'folder' : 'file'
    const ok = window.confirm(
      `Delete ${kind} "${item.name}"? This cannot be undone.`,
    )
    if (!ok) return
    try {
      await workspaceDeleteEntry(workspaceId, item.relativePath)
      onStructureChanged()
    } catch (err) {
      console.error(err)
      window.alert(err instanceof Error ? err.message : String(err))
    }
  }, [item.isDir, item.name, item.relativePath, workspaceId, onStructureChanged])

  const createSubfolder = useCallback(async () => {
    setRowMenu(null)
    try {
      await workspaceCreateDir(workspaceId, item.relativePath, 'New folder')
      onStructureChanged()
      if (item.isDir && !isOpen) {
        setIsOpen(true)
        setLoading(true)
        try {
          const result = await workspaceListDir(workspaceId, item.relativePath)
          setChildren(result)
        } catch (err) {
          console.error('Failed to list directory:', err)
        } finally {
          setLoading(false)
        }
      } else if (item.isDir && isOpen) {
        setLoading(true)
        try {
          const result = await workspaceListDir(workspaceId, item.relativePath)
          setChildren(result)
        } catch (err) {
          console.error('Failed to list directory:', err)
        } finally {
          setLoading(false)
        }
      }
    } catch (err) {
      console.error(err)
      window.alert(err instanceof Error ? err.message : String(err))
    }
  }, [
    workspaceId,
    item.relativePath,
    item.isDir,
    isOpen,
    onStructureChanged,
  ])

  const rowClassName = cn(
    'flex w-full items-center gap-2 overflow-hidden rounded-md text-left text-sm ring-sidebar-ring outline-hidden transition-[width,height,padding,color,background-color]',
    'h-7 py-0 px-2 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-inset',
    depth > 0 && 'ml-3 border-l border-sidebar-border/30 pl-2',
    item.isDir ? 'cursor-default' : 'cursor-default select-none',
  )

  const moveTargetAttrs = item.isDir
    ? {
        'data-braian-explorer-move-target': '1' as const,
        'data-explorer-dest-dir': item.relativePath,
      }
    : {
        'data-braian-explorer-move-target': '1' as const,
        'data-explorer-dest-dir': parentDirectoryOfRelativePath(item.relativePath),
      }

  const rowInner = renaming ? (
    <Input
      value={renameDraft}
      onChange={(e) => setRenameDraft(e.target.value)}
      className="h-6 min-w-0 flex-1 text-xs"
      autoFocus
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          ignoreRenameBlurRef.current = true
          void submitRename()
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          ignoreRenameBlurRef.current = true
          cancelRename()
        }
      }}
      onBlur={() => onRenameBlur()}
    />
  ) : (
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      {item.isDir && (
        <span className="shrink-0">
          {isOpen ? (
            <ChevronDown className="size-3 text-muted-foreground/70" />
          ) : (
            <ChevronRight className="size-3 text-muted-foreground/70" />
          )}
        </span>
      )}
      {!item.isDir && <span className="w-3 shrink-0" />}
      <FileIcon name={item.name} isDir={item.isDir} />
      <span className="truncate text-xs">{item.name}</span>
      {loading && (
        <Loader2 className="size-3 animate-spin text-muted-foreground/50" />
      )}
    </div>
  )

  const onRowPointerDownCapture = useCallback(
    (pe: React.PointerEvent) => {
      if (renaming) return
      workspaceFilePointerDragMaybeStartOnPointerDown(pe, {
        relativePath: item.relativePath,
        displayName: item.name,
        isDir: item.isDir,
      })
    },
    [renaming, item.relativePath, item.name, item.isDir],
  )

  return (
    <li className="relative min-w-0 list-none">
      {rowMenu ? (
        <div
          ref={menuRef}
          className="bg-popover text-popover-foreground border-border fixed z-[200] min-w-[9rem] rounded-md border p-1 shadow-md"
          style={{ left: rowMenu.x, top: rowMenu.y }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button
            type="button"
            className="hover:bg-accent focus:bg-accent flex w-full rounded-sm px-2 py-1.5 text-left text-xs"
            onClick={() => {
              setRowMenu(null)
              openInOs()
            }}
          >
            Open
          </button>
          <button
            type="button"
            className="hover:bg-accent focus:bg-accent flex w-full rounded-sm px-2 py-1.5 text-left text-xs"
            onClick={startRename}
          >
            Rename…
          </button>
          {item.isDir ? (
            <button
              type="button"
              className="hover:bg-accent focus:bg-accent flex w-full rounded-sm px-2 py-1.5 text-left text-xs"
              onClick={() => void createSubfolder()}
            >
              New folder
            </button>
          ) : null}
          <button
            type="button"
            className="text-destructive hover:bg-destructive/10 focus:bg-destructive/10 flex w-full rounded-sm px-2 py-1.5 text-left text-xs"
            onClick={() => void deleteEntry()}
          >
            Delete…
          </button>
        </div>
      ) : null}

      {item.isDir ? (
        <button
          type="button"
          className={rowClassName}
          {...moveTargetAttrs}
          onPointerDownCapture={onRowPointerDownCapture}
          onClick={onFolderClick}
          onDoubleClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            openInOs()
          }}
          onContextMenu={onRowContextMenu}
          title={item.relativePath}
        >
          {rowInner}
        </button>
      ) : (
        <div
          className={rowClassName}
          {...moveTargetAttrs}
          onPointerDownCapture={onRowPointerDownCapture}
          onDoubleClick={() => openInOs()}
          onContextMenu={onRowContextMenu}
          title={`${item.relativePath} — drag into the message field to @ mention in chat`}
        >
          {rowInner}
        </div>
      )}

      {isOpen && item.isDir && (
        <ul className="mt-0.5 flex w-full min-w-0 flex-col gap-1 list-none">
          {children.length === 0 && !loading ? (
            <div className="pl-8 py-1 text-[10px] text-muted-foreground/50 italic">
              Empty
            </div>
          ) : (
            children.map((child) => (
              <FileTreeItem
                key={`${child.relativePath}-${treeRefreshKey}`}
                item={child}
                depth={depth + 1}
                workspaceId={workspaceId}
                rootPath={rootPath}
                treeRefreshKey={treeRefreshKey}
                onStructureChanged={onStructureChanged}
              />
            ))
          )}
        </ul>
      )}
    </li>
  )
}

export function WorkspaceFileTree() {
  const { activeWorkspace, activeWorkspaceId } = useWorkspace()
  const [rootItems, setRootItems] = useState<WorkspaceDirEntryDto[]>([])
  const [loading, setLoading] = useState(false)
  const [treeRefreshKey, setTreeRefreshKey] = useState(0)

  const bumpTree = useCallback(() => {
    setTreeRefreshKey((k) => k + 1)
  }, [])

  useEffect(() => {
    if (!activeWorkspaceId || !activeWorkspace?.rootPath) {
      setRootItems([])
      return
    }

    setLoading(true)
    workspaceListDir(activeWorkspaceId, '')
      .then(setRootItems)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [activeWorkspaceId, activeWorkspace?.rootPath, treeRefreshKey])

  useEffect(() => {
    if (!activeWorkspaceId) return () => {}

    const off = registerWorkspaceExplorerMoveHandler((payload, destParent) => {
      void (async () => {
        try {
          await workspaceMoveEntry(
            activeWorkspaceId,
            payload.relativePath,
            destParent,
          )
          bumpTree()
        } catch (err) {
          console.error(err)
          window.alert(err instanceof Error ? err.message : String(err))
        }
      })()
    })
    return off
  }, [activeWorkspaceId, bumpTree])

  const onNewFolderRoot = useCallback(async () => {
    if (!activeWorkspaceId) return
    try {
      await workspaceCreateDir(activeWorkspaceId, '', 'New folder')
      bumpTree()
    } catch (err) {
      console.error(err)
      window.alert(err instanceof Error ? err.message : String(err))
    }
  }, [activeWorkspaceId, bumpTree])

  if (!activeWorkspace || !activeWorkspace.rootPath) {
    return (
      <div className="p-4 text-xs text-muted-foreground italic">
        No active workspace folder.
      </div>
    )
  }

  return (
    <div
      className="flex-1 overflow-y-auto overflow-x-hidden p-0"
      data-braian-explorer-move-target="1"
      data-explorer-dest-dir=""
    >
      <div className="p-0">
        <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-2">
          <div className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground/60">
            Files
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 text-muted-foreground hover:text-sidebar-foreground"
            title="New folder in workspace root"
            onClick={() => void onNewFolderRoot()}
          >
            <FolderPlus className="size-4" />
          </Button>
        </div>
        <div className="min-h-0">
          <ul className="px-2 pb-4 flex w-full min-w-0 flex-col gap-1 list-none">
            {loading && rootItems.length === 0 ? (
              <div className="flex items-center justify-center p-8">
                <Loader2 className="size-5 animate-spin text-muted-foreground/30" />
              </div>
            ) : (
              rootItems.map((item) => (
                <FileTreeItem
                  key={`${item.relativePath}-${treeRefreshKey}`}
                  item={item}
                  depth={0}
                  workspaceId={activeWorkspaceId}
                  rootPath={activeWorkspace.rootPath}
                  treeRefreshKey={treeRefreshKey}
                  onStructureChanged={bumpTree}
                />
              ))
            )}
          </ul>
        </div>
      </div>
    </div>
  )
}

export function WorkspaceFileTreeSidebar() {
  const { fileTreeOpen, setFileTreeOpen } = useWorkspace()

  return (
    <div
      className={cn(
        'box-border flex h-svh min-h-0 shrink-0 flex-col border-r border-sidebar-border/50 bg-sidebar pt-2 text-sidebar-foreground transition-[width] duration-200 ease-in-out',
        fileTreeOpen
          ? 'w-(--sidebar-width) overflow-hidden'
          : 'w-0 overflow-hidden border-r-0',
      )}
      style={{
        minWidth: fileTreeOpen ? undefined : '0px',
        flexShrink: 0,
      }}
    >
      {fileTreeOpen ? (
        <div className="flex min-h-0 w-(--sidebar-width) flex-1 flex-col">
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-sidebar-border/50 px-2 md:px-3">
            <span className="truncate text-sm font-semibold">Explorer</span>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0 text-sidebar-foreground/70 hover:text-sidebar-foreground"
              onClick={() => setFileTreeOpen(false)}
              title="Close File Explorer"
            >
              <PanelLeftClose className="size-4" />
            </Button>
          </div>
          <WorkspaceFileTree />
        </div>
      ) : null}
    </div>
  )
}
