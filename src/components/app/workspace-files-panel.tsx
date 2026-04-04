import { ChevronRight, File as FileGlyph, FolderOpen, Paperclip } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { ScrollArea } from '@/components/ui/scroll-area'
import { addContextFileEntry } from '@/lib/chat-sessions/store'
import {
  joinRootRelative,
  parentRelativeDir,
} from '@/lib/workspace-path-utils'
import {
  workspaceListDir,
  type WorkspaceDirEntryDto,
} from '@/lib/workspace-api'
import { cn } from '@/lib/utils'
import { revealItemInDir } from '@tauri-apps/plugin-opener'

type WorkspaceFilesPanelProps = {
  workspaceId: string
  workspaceRootPath: string
  sessionKey: string
  className?: string
}

export function WorkspaceFilesPanel({
  workspaceId,
  workspaceRootPath,
  sessionKey,
  className,
}: WorkspaceFilesPanelProps) {
  const [open, setOpen] = useState(false)
  const [relativeDir, setRelativeDir] = useState('')
  const [entries, setEntries] = useState<WorkspaceDirEntryDto[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await workspaceListDir(workspaceId, relativeDir)
      setEntries(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not list folder.')
      setEntries([])
    } finally {
      setLoading(false)
    }
  }, [workspaceId, relativeDir])

  useEffect(() => {
    if (!open) return
    void load()
  }, [open, load])

  const attachFile = (e: WorkspaceDirEntryDto) => {
    if (e.isDir) return
    addContextFileEntry(sessionKey, {
      relativePath: e.relativePath,
      displayName: e.name,
    })
  }

  const onReveal = (e: WorkspaceDirEntryDto) => {
    const abs = joinRootRelative(workspaceRootPath, e.relativePath)
    void revealItemInDir(abs).catch((err) => console.error(err))
  }

  const breadcrumb =
    relativeDir === '' ? (
      <span className="text-text-3">Workspace root</span>
    ) : (
      <span className="text-text-3 truncate" title={relativeDir}>
        {relativeDir.replace(/\//g, ' / ')}
      </span>
    )

  return (
    <Collapsible open={open} onOpenChange={setOpen} className={cn(className)}>
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-text-2 hover:text-text-1 h-8 w-full justify-between gap-2 px-2 font-normal"
        >
          <span className="flex min-w-0 items-center gap-2">
            <FolderOpen className="size-3.5 shrink-0 opacity-70" aria-hidden />
            <span className="truncate">Workspace files</span>
          </span>
          <ChevronRight
            className={cn(
              'size-3.5 shrink-0 opacity-50 transition-transform',
              open && 'rotate-90',
            )}
            aria-hidden
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-border bg-muted/20 mt-1 rounded-lg border px-2 py-2">
          <div className="text-text-3 mb-2 flex flex-wrap items-center gap-1 text-xs">
            {breadcrumb}
            {relativeDir !== '' ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-accent-600 h-6 px-1.5 text-xs"
                onClick={() => setRelativeDir(parentRelativeDir(relativeDir))}
              >
                Up
              </Button>
            ) : null}
          </div>
          {error ? (
            <p className="text-destructive mb-2 text-xs">{error}</p>
          ) : null}
          <ScrollArea className="h-[min(220px,40dvh)]">
            <ul className="flex flex-col gap-0.5 pr-2 text-sm">
              {loading ? (
                <li className="text-text-3 px-1 py-2 text-xs">Loading…</li>
              ) : entries.length === 0 ? (
                <li className="text-text-3 px-1 py-2 text-xs">Empty folder.</li>
              ) : (
                entries.map((e) => (
                  <li
                    key={e.relativePath}
                    className="hover:bg-muted/60 flex flex-wrap items-center gap-1 rounded-md px-1 py-0.5"
                  >
                    <button
                      type="button"
                      className={cn(
                        'text-text-2 min-w-0 flex-1 truncate text-left text-xs',
                        e.isDir && 'font-medium',
                      )}
                      onClick={() => {
                        if (e.isDir) setRelativeDir(e.relativePath)
                        else attachFile(e)
                      }}
                    >
                      <span className="inline-flex items-center gap-1">
                        {e.isDir ? (
                          <FolderOpen
                            className="text-text-3 size-3 shrink-0"
                            aria-hidden
                          />
                        ) : (
                          <FileGlyph
                            className="text-text-3 size-3 shrink-0"
                            aria-hidden
                          />
                        )}
                        {e.name}
                      </span>
                    </button>
                    {!e.isDir ? (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7 shrink-0"
                          title="Add to chat context"
                          onClick={() => attachFile(e)}
                        >
                          <Paperclip className="size-3.5" aria-hidden />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7 shrink-0"
                          title="Show in file manager"
                          onClick={() => onReveal(e)}
                        >
                          <FolderOpen className="size-3.5" aria-hidden />
                        </Button>
                      </>
                    ) : null}
                  </li>
                ))
              )}
            </ul>
          </ScrollArea>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
