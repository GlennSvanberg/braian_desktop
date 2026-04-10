import { EditorView } from '@codemirror/view'
import CodeMirror from '@uiw/react-codemirror'
import { githubDark, githubLight } from '@uiw/codemirror-theme-github'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'

import {
  clearWorkspaceFileCanvasLiveGetter,
  setWorkspaceFileCanvasLiveGetter,
} from '@/lib/ai/workspace-file-canvas-live'
import { patchWorkspaceFileArtifactBody } from '@/lib/chat-sessions/store'
import { workspaceWriteTextFile } from '@/lib/workspace-api'
import { cn } from '@/lib/utils'

import { getLanguageExtensionsForPath } from './workspace-text-file-codemirror-language'

const DEBOUNCE_MS = 450

function subscribeHtmlClass(cb: () => void) {
  const el = document.documentElement
  const mo = new MutationObserver(cb)
  mo.observe(el, { attributes: true, attributeFilter: ['class'] })
  return () => mo.disconnect()
}

function getIsDarkSnapshot() {
  return document.documentElement.classList.contains('dark')
}

function getServerDarkSnapshot() {
  return false
}

export type WorkspaceTextFileCanvasProps = {
  workspaceId: string
  relativePath: string
  body: string
  truncated?: boolean
  title?: string
  /** Registers live buffer for the model (fresher than debounced disk + thread patch). */
  liveSessionKey?: string
  sessionKey: string
  className?: string
}

export function WorkspaceTextFileCanvas({
  workspaceId,
  relativePath,
  body,
  truncated,
  title,
  liveSessionKey,
  sessionKey,
  className,
}: WorkspaceTextFileCanvasProps) {
  const [text, setText] = useState(body)
  const liveRef = useRef(body)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSyncedRef = useRef(body)
  const [writeError, setWriteError] = useState<string | null>(null)

  const isDark = useSyncExternalStore(
    subscribeHtmlClass,
    getIsDarkSnapshot,
    getServerDarkSnapshot,
  )

  useEffect(() => {
    if (body !== lastSyncedRef.current) {
      lastSyncedRef.current = body
      setText(body)
      liveRef.current = body
    }
  }, [body])

  useEffect(() => {
    if (!liveSessionKey) return
    setWorkspaceFileCanvasLiveGetter(liveSessionKey, () => ({
      body: liveRef.current,
    }))
    return () => {
      clearWorkspaceFileCanvasLiveGetter(liveSessionKey)
    }
  }, [liveSessionKey])

  const flushDebounced = useCallback(() => {
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
  }, [])

  useEffect(() => () => flushDebounced(), [flushDebounced])

  const persist = useCallback(
    async (next: string) => {
      try {
        setWriteError(null)
        await workspaceWriteTextFile(workspaceId, relativePath, next)
        patchWorkspaceFileArtifactBody(sessionKey, next)
        lastSyncedRef.current = next
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        setWriteError(msg)
      }
    },
    [workspaceId, relativePath, sessionKey],
  )

  const onChange = useCallback(
    (next: string) => {
      setText(next)
      liveRef.current = next
      flushDebounced()
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null
        void persist(next)
      }, DEBOUNCE_MS)
    },
    [flushDebounced, persist],
  )

  const extensions = useMemo(() => {
    const lang = getLanguageExtensionsForPath(relativePath)
    const theme = isDark ? githubDark : githubLight
    return [...lang, theme, EditorView.lineWrapping]
  }, [relativePath, isDark])

  const heading = title ?? relativePath

  return (
    <div
      className={cn(
        'flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden',
        className,
      )}
    >
      <div className="text-text-2 shrink-0 px-0.5 font-mono text-xs">
        <span className="text-text-1 font-medium">{heading}</span>
        {truncated ? (
          <span className="text-text-3 ml-2">
            (truncated — file larger than read limit)
          </span>
        ) : null}
      </div>
      {writeError ? (
        <p className="text-destructive shrink-0 px-0.5 text-xs">{writeError}</p>
      ) : null}
      <div
        className={cn(
          'border-border bg-background/80 focus-within:ring-ring/40',
          'min-h-0 min-w-0 flex-1 overflow-hidden rounded-lg border',
          'focus-within:ring-2',
        )}
      >
        {/* theme="none": @uiw defaults to light base theme and it overrides githubDark in the stack */}
        <CodeMirror
          key={relativePath}
          value={text}
          height="100%"
          theme="none"
          className="braian-workspace-file-cm h-full min-h-[12rem] text-[13px] leading-relaxed"
          extensions={extensions}
          indentWithTab
          basicSetup={{
            lineNumbers: true,
            foldGutter: true,
            dropCursor: true,
            allowMultipleSelections: true,
          }}
          onChange={(v) => onChange(v)}
          aria-label={`Edit ${heading}`}
        />
      </div>
    </div>
  )
}
