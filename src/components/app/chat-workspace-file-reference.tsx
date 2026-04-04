import { Copy, ExternalLink, FolderOpen } from 'lucide-react'
import { useCallback, useState } from 'react'
import { openPath, revealItemInDir } from '@tauri-apps/plugin-opener'

import { Button } from '@/components/ui/button'
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

  const Wrapper = variant === 'block' ? 'div' : 'span'
  const disabled = !safe

  return (
    <Wrapper
      className={cn(
        'chat-workspace-file-ref not-prose',
        variant === 'block'
          ? 'border-border bg-muted/30 my-2 flex flex-col gap-2 rounded-lg border px-2.5 py-2'
          : 'my-0.5 inline-flex max-w-full flex-col gap-1.5 align-middle',
      )}
    >
      <span
        className={cn(
          'font-mono text-[0.8125rem] text-text-1',
          variant === 'inline' && 'break-all',
        )}
        title={absolutePath}
      >
        {relativePath}
      </span>
      <span
        className={cn(
          'flex flex-wrap items-center gap-1',
          variant === 'inline' ? '-ml-0.5' : '',
        )}
      >
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="h-7 gap-1 px-2 text-xs"
          disabled={disabled}
          title="Copy absolute path to clipboard"
          onClick={() => void onCopyPath()}
        >
          <Copy className="size-3.5 shrink-0" aria-hidden />
          {copied ? 'Copied' : 'Copy path'}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="h-7 gap-1 px-2 text-xs"
          disabled={disabled}
          title="Show in file manager"
          onClick={onReveal}
        >
          <FolderOpen className="size-3.5 shrink-0" aria-hidden />
          Show in folder
        </Button>
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="h-7 gap-1 px-2 text-xs"
          disabled={disabled}
          title="Open with the default app"
          onClick={onOpen}
        >
          <ExternalLink className="size-3.5 shrink-0" aria-hidden />
          Open
        </Button>
      </span>
    </Wrapper>
  )
}
