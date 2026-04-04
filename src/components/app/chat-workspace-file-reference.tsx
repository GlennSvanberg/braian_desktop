import { ChevronDown, Copy, ExternalLink, FileText, FolderOpen } from 'lucide-react'
import { useCallback, useState } from 'react'
import { openPath, revealItemInDir } from '@tauri-apps/plugin-opener'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { isPathUnderRoot, joinRootRelative } from '@/lib/workspace-path-utils'
import { cn } from '@/lib/utils'

export type ChatWorkspaceFileReferenceProps = {
  relativePath: string
  workspaceRootPath: string
  variant: 'inline' | 'block'
}

export function ChatWorkspaceFileReference({
  relativePath,
  workspaceRootPath,
  variant,
}: ChatWorkspaceFileReferenceProps) {
  const [copied, setCopied] = useState(false)

  const absolutePath = joinRootRelative(workspaceRootPath, relativePath)
  const safe = isPathUnderRoot(absolutePath, workspaceRootPath)

  const onCopyPath = useCallback(async () => {
    if (!safe) return
    try {
      await navigator.clipboard.writeText(absolutePath)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      window.prompt('Copy this path:', absolutePath)
    }
  }, [absolutePath, safe])

  const onReveal = useCallback(() => {
    if (!safe) return
    void revealItemInDir(absolutePath).catch((err) => console.error(err))
  }, [absolutePath, safe])

  const onOpen = useCallback(() => {
    if (!safe) return
    void openPath(absolutePath).catch((err) => console.error(err))
  }, [absolutePath, safe])

  const disabled = !safe

  if (variant === 'inline') {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            title={absolutePath}
            className={cn(
              'chat-workspace-file-ref not-prose inline-flex max-w-full min-w-0 items-center gap-0.5 align-baseline',
              'rounded-md border border-transparent bg-muted px-1.5 py-0.5 font-mono text-[0.8125em] text-text-1',
              'hover:border-border hover:bg-muted/80',
              'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
              'disabled:pointer-events-none disabled:opacity-50',
            )}
          >
            <span className="min-w-0 truncate">{relativePath}</span>
            <ChevronDown className="text-text-3 size-3 shrink-0 opacity-70" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[10rem]">
          <DropdownMenuItem disabled={disabled} onSelect={() => void onCopyPath()}>
            <Copy className="size-4" aria-hidden />
            {copied ? 'Copied' : 'Copy path'}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={disabled} onSelect={onReveal}>
            <FolderOpen className="size-4" aria-hidden />
            Show in folder
          </DropdownMenuItem>
          <DropdownMenuItem disabled={disabled} onSelect={onOpen}>
            <ExternalLink className="size-4" aria-hidden />
            Open
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  return (
    <div
      className={cn(
        'chat-workspace-file-ref not-prose border-border bg-muted/30 my-2 flex flex-row flex-wrap items-center gap-2 rounded-lg border px-2.5 py-2',
      )}
    >
      <div className="text-text-3 flex min-w-0 flex-1 items-center gap-2">
        <FileText className="size-4 shrink-0" aria-hidden />
        <span
          className="font-mono text-[0.8125rem] text-text-1 min-w-0 break-words"
          title={absolutePath}
        >
          {relativePath}
        </span>
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-0.5">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-text-2"
          disabled={disabled}
          title="Copy absolute path"
          onClick={() => void onCopyPath()}
        >
          <Copy className="size-3.5" aria-hidden />
          <span className="sr-only">{copied ? 'Copied' : 'Copy path'}</span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-text-2"
          disabled={disabled}
          title="Show in file manager"
          onClick={onReveal}
        >
          <FolderOpen className="size-3.5" aria-hidden />
          <span className="sr-only">Show in folder</span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-text-2"
          disabled={disabled}
          title="Open with default app"
          onClick={onOpen}
        >
          <ExternalLink className="size-3.5" aria-hidden />
          <span className="sr-only">Open</span>
        </Button>
      </div>
    </div>
  )
}
