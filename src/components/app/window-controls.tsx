import { getCurrentWindow } from '@tauri-apps/api/window'
import { Maximize2, Minus, Shrink, X } from 'lucide-react'
import * as React from 'react'

import { cn } from '@/lib/utils'

const ctrlBtn =
  'inline-flex h-9 w-10 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'

export function WindowControls() {
  const [isMaximized, setIsMaximized] = React.useState(false)

  React.useEffect(() => {
    const win = getCurrentWindow()
    let cancelled = false
    let unlisten: (() => void) | undefined

    const sync = () => {
      if (cancelled) return
      void win.isMaximized().then((m) => {
        if (!cancelled) setIsMaximized(m)
      })
    }

    sync()
    void win.onResized(() => sync()).then((fn) => {
      if (cancelled) fn()
      else unlisten = fn
    })

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [])

  const win = getCurrentWindow()

  return (
    <div
      className="flex shrink-0 items-center gap-0.5 pr-1 pl-2"
      data-tauri-drag-region={false}
    >
      <button
        type="button"
        className={ctrlBtn}
        aria-label="Minimize window"
        onClick={() => void win.minimize()}
      >
        <Minus className="size-4" strokeWidth={2} />
      </button>
      <button
        type="button"
        className={ctrlBtn}
        aria-label={isMaximized ? 'Restore window' : 'Maximize window'}
        onClick={() => void win.toggleMaximize()}
      >
        {isMaximized ? (
          <Shrink className="size-3.5" strokeWidth={2} />
        ) : (
          <Maximize2 className="size-3.5" strokeWidth={2} />
        )}
      </button>
      <button
        type="button"
        className={cn(
          ctrlBtn,
          'hover:bg-destructive/15 hover:text-destructive',
        )}
        aria-label="Close window"
        onClick={() => void win.close()}
      >
        <X className="size-4" strokeWidth={2} />
      </button>
    </div>
  )
}
