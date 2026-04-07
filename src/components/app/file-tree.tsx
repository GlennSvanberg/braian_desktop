import React, { useState, useEffect, useCallback } from 'react'
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
  PanelLeftClose
} from 'lucide-react'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { join } from '@tauri-apps/api/path'

import { useWorkspace } from './workspace-context'
import { workspaceListDir, type WorkspaceDirEntryDto } from '@/lib/workspace-api'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

interface FileTreeItemProps {
  item: WorkspaceDirEntryDto
  depth: number
  workspaceId: string
  rootPath: string
}

const FileIcon = ({ name, isDir }: { name: string; isDir: boolean }) => {
  if (isDir) return <Folder className="size-4 shrink-0 text-blue-500/80" />
  
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

const FileTreeItem = ({ item, depth, workspaceId, rootPath }: FileTreeItemProps) => {
  const [isOpen, setIsOpen] = useState(false)
  const [children, setChildren] = useState<WorkspaceDirEntryDto[]>([])
  const [loading, setLoading] = useState(false)

  const toggleFolder = useCallback(async (e: React.MouseEvent) => {
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
  }, [item.isDir, item.relativePath, isOpen, children.length, workspaceId])

  const handleDoubleClick = useCallback(async () => {
    if (item.isDir) return
    try {
      const fullPath = await join(rootPath, item.relativePath)
      await revealItemInDir(fullPath)
    } catch (err) {
      console.error('Failed to reveal file:', err)
    }
  }, [item.isDir, item.relativePath, rootPath])

  const handleDragStart = (e: React.DragEvent) => {
    if (item.isDir) return
    e.dataTransfer.setData('application/x-braian-file-path', item.relativePath)
    e.dataTransfer.setData('text/plain', item.name)
    e.dataTransfer.effectAllowed = 'copy'
  }

  return (
    <li className="relative min-w-0 list-none">
      <button
        className={cn(
          "flex w-full items-center gap-2 overflow-hidden rounded-md text-left text-sm ring-sidebar-ring outline-hidden transition-[width,height,padding,color,background-color]",
          "h-7 py-0 px-2 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-inset",
          depth > 0 && "ml-3 border-l border-sidebar-border/30 pl-2"
        )}
        onClick={item.isDir ? toggleFolder : undefined}
        onDoubleClick={handleDoubleClick}
        draggable={!item.isDir}
        onDragStart={!item.isDir ? handleDragStart : undefined}
        title={item.relativePath}
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
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
          {loading && <Loader2 className="size-3 animate-spin text-muted-foreground/50" />}
        </div>
      </button>
      
      {isOpen && item.isDir && (
        <ul className="mt-0.5 flex w-full min-w-0 flex-col gap-1 list-none">
          {children.length === 0 && !loading ? (
            <div className="pl-8 py-1 text-[10px] text-muted-foreground/50 italic">Empty</div>
          ) : (
            children.map((child) => (
              <FileTreeItem 
                key={child.relativePath} 
                item={child} 
                depth={depth + 1} 
                workspaceId={workspaceId}
                rootPath={rootPath}
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
  }, [activeWorkspaceId, activeWorkspace?.rootPath])

  if (!activeWorkspace || !activeWorkspace.rootPath) {
    return (
      <div className="p-4 text-xs text-muted-foreground italic">
        No active workspace folder.
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden p-0">
      <div className="p-0">
        <div className="px-4 pt-4 pb-2 text-[10px] uppercase tracking-wider font-bold text-muted-foreground/60">
          Files
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
                  key={item.relativePath} 
                  item={item} 
                  depth={0} 
                  workspaceId={activeWorkspaceId}
                  rootPath={activeWorkspace.rootPath}
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
        'flex shrink-0 flex-col border-r border-sidebar-border/50 bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-in-out',
        fileTreeOpen
          ? 'w-(--sidebar-width) overflow-hidden'
          : 'w-0 overflow-hidden border-r-0',
      )}
      style={{
        height: '100svh',
        minWidth: fileTreeOpen ? undefined : '0px',
        flexShrink: 0,
      }}
    >
      {fileTreeOpen ? (
        <div className="flex min-h-0 w-(--sidebar-width) flex-1 flex-col">
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-sidebar-border/50 px-4">
            <span className="truncate text-sm font-semibold">Explorer</span>
            <Button
              variant="ghost"
              size="icon"
              className="-mr-2 size-7 text-sidebar-foreground/70 hover:text-sidebar-foreground"
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
