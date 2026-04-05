import '@mdxeditor/editor/style.css'

import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  ChangeCodeMirrorLanguage,
  CodeToggle,
  ConditionalContents,
  CreateLink,
  MDXEditor,
  type MDXEditorMethods,
  InsertCodeBlock,
  InsertTable,
  ListsToggle,
  UndoRedo,
  Separator,
  codeBlockPlugin,
  codeMirrorPlugin,
  headingsPlugin,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  markdownShortcutPlugin,
  quotePlugin,
  tablePlugin,
  toolbarPlugin,
} from '@mdxeditor/editor'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  clearDocumentCanvasLiveGetter,
  setDocumentCanvasLiveGetter,
} from '@/lib/ai/document-canvas-live'
import { cn } from '@/lib/utils'

const CODE_LANGUAGES: Record<string, string> = {
  '': 'Plain text',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  markdown: 'Markdown',
  bash: 'Bash',
  json: 'JSON',
  css: 'CSS',
  html: 'HTML',
  rust: 'Rust',
  python: 'Python',
}

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
  return true
}

export type CanvasSelectionSubmitPayload = {
  instruction: string
  selectedMarkdown: string
}

export type MarkdownDocumentCanvasProps = {
  markdown: string
  onMarkdownChange?: (next: string) => void
  readOnly?: boolean
  className?: string
  placeholder?: ReactNode
  /** When set, registers a live markdown getter for AI turns (fresher than debounced store). */
  liveSessionKey?: string
  /** Inline “ask about selection” — opens near the current selection. */
  onCanvasSelectionAsk?: (payload: CanvasSelectionSubmitPayload) => void
}

export function MarkdownDocumentCanvas({
  markdown,
  onMarkdownChange,
  readOnly = false,
  className,
  placeholder = 'Start writing…',
  liveSessionKey,
  onCanvasSelectionAsk,
}: MarkdownDocumentCanvasProps) {
  const [mounted, setMounted] = useState(false)
  const editorRef = useRef<MDXEditorMethods>(null)
  const lastSyncedRef = useRef(markdown)
  const liveBodyRef = useRef(markdown)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [selectionBar, setSelectionBar] = useState<{
    rect: DOMRect
    selectedMarkdown: string
  } | null>(null)
  const [selectionInstruction, setSelectionInstruction] = useState('')

  const isDark = useSyncExternalStore(
    subscribeHtmlClass,
    getIsDarkSnapshot,
    getServerDarkSnapshot,
  )

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (markdown !== lastSyncedRef.current) {
      editorRef.current?.setMarkdown(markdown)
      lastSyncedRef.current = markdown
      liveBodyRef.current = markdown
    }
  }, [markdown])

  useEffect(() => {
    if (!mounted || !liveSessionKey || readOnly) {
      return
    }
    setDocumentCanvasLiveGetter(liveSessionKey, () => {
      const fromEditor = editorRef.current?.getMarkdown()
      if (typeof fromEditor === 'string') {
        return { body: fromEditor }
      }
      return { body: liveBodyRef.current }
    })
    return () => {
      clearDocumentCanvasLiveGetter(liveSessionKey)
    }
  }, [mounted, liveSessionKey, readOnly])

  const flushDebounced = useCallback(() => {
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
  }, [])

  useEffect(() => () => flushDebounced(), [flushDebounced])

  useEffect(() => {
    if (!selectionBar || readOnly) return
    const onMouseDown = (ev: MouseEvent) => {
      const t = ev.target as Node
      const bar = document.getElementById('braian-canvas-selection-bar')
      if (bar?.contains(t)) return
      setSelectionBar(null)
      setSelectionInstruction('')
    }
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        setSelectionBar(null)
        setSelectionInstruction('')
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [selectionBar, readOnly])

  useEffect(() => {
    if (readOnly || !onCanvasSelectionAsk || !mounted) return
    const onMouseUp = () => {
      window.setTimeout(() => {
        const md = editorRef.current?.getSelectionMarkdown?.() ?? ''
        const trimmed = md.trim()
        if (!trimmed) {
          setSelectionBar(null)
          return
        }
        const sel = window.getSelection()
        if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
          setSelectionBar(null)
          return
        }
        const range = sel.getRangeAt(0)
        const root = range.commonAncestorContainer
        const editable = document.querySelector('.prose-markdown-canvas')
        if (
          !editable ||
          !(root instanceof Node) ||
          !editable.contains(root)
        ) {
          setSelectionBar(null)
          return
        }
        const rect = range.getBoundingClientRect()
        if (rect.width === 0 && rect.height === 0) {
          setSelectionBar(null)
          return
        }
        setSelectionBar({ rect, selectedMarkdown: md })
        setSelectionInstruction('')
      }, 0)
    }
    document.addEventListener('mouseup', onMouseUp)
    return () => document.removeEventListener('mouseup', onMouseUp)
  }, [readOnly, onCanvasSelectionAsk, mounted])

  const handleChange = useCallback(
    (next: string, initialMarkdownNormalize: boolean) => {
      liveBodyRef.current = next
      lastSyncedRef.current = next
      if (!onMarkdownChange) return
      if (initialMarkdownNormalize) {
        flushDebounced()
        onMarkdownChange(next)
        return
      }
      flushDebounced()
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null
        onMarkdownChange(next)
      }, 280)
    },
    [flushDebounced, onMarkdownChange],
  )

  const plugins = useMemo(
    () => [
      toolbarPlugin({
        toolbarContents: () => (
          <ConditionalContents
            options={[
              {
                when: (editor) => editor?.editorType === 'codeblock',
                contents: () => <ChangeCodeMirrorLanguage />,
              },
              {
                fallback: () => (
                  <>
                    <UndoRedo />
                    <Separator />
                    <BoldItalicUnderlineToggles />
                    <CodeToggle />
                    <Separator />
                    <ListsToggle />
                    <Separator />
                    <BlockTypeSelect />
                    <Separator />
                    <CreateLink />
                    <Separator />
                    <InsertCodeBlock />
                    <InsertTable />
                  </>
                ),
              },
            ]}
          />
        ),
      }),
      listsPlugin(),
      quotePlugin(),
      headingsPlugin(),
      linkPlugin(),
      linkDialogPlugin(),
      tablePlugin(),
      markdownShortcutPlugin(),
      codeBlockPlugin(),
      codeMirrorPlugin({ codeBlockLanguages: CODE_LANGUAGES }),
    ],
    [],
  )

  const submitSelection = useCallback(() => {
    if (!selectionBar || !onCanvasSelectionAsk) return
    const instruction = selectionInstruction.trim()
    if (!instruction) return
    onCanvasSelectionAsk({
      instruction,
      selectedMarkdown: selectionBar.selectedMarkdown,
    })
    setSelectionBar(null)
    setSelectionInstruction('')
    editorRef.current?.focus()
  }, [
    onCanvasSelectionAsk,
    selectionBar,
    selectionInstruction,
  ])

  const bar =
    selectionBar && onCanvasSelectionAsk ? (
      <div
        id="braian-canvas-selection-bar"
        className="border-border bg-card text-text-2 flex max-w-[min(96vw,380px)] flex-col gap-2 rounded-lg border p-2 shadow-lg"
        style={{
          position: 'fixed',
          top: Math.min(
            selectionBar.rect.bottom + 8,
            window.innerHeight - 120,
          ),
          left: Math.min(
            selectionBar.rect.left,
            window.innerWidth - 390,
          ),
          zIndex: 60,
        }}
        role="dialog"
        aria-label="Ask about selected text"
      >
        <p className="text-text-3 px-0.5 text-xs">
          Ask about this selection (assistant will prefer patching this region).
        </p>
        <div className="flex gap-2">
          <Input
            value={selectionInstruction}
            onChange={(e) => setSelectionInstruction(e.target.value)}
            placeholder="Instruction…"
            className="min-w-0 flex-1"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                submitSelection()
              }
            }}
          />
          <Button
            type="button"
            size="sm"
            disabled={!selectionInstruction.trim()}
            onClick={() => submitSelection()}
          >
            Send
          </Button>
        </div>
      </div>
    ) : null

  return (
    <ScrollArea className={cn('min-h-0 flex-1', className)}>
      <div
        className={cn(
          'markdown-document-canvas bg-background border-border text-text-2 mx-auto max-w-2xl rounded-lg border px-2 py-3 shadow-sm md:px-4 md:py-4',
          isDark ? 'dark-theme' : 'light-theme',
        )}
      >
        {bar}
        {!mounted ? (
          <div className="text-text-3 min-h-[200px] px-3 py-4 text-sm leading-relaxed">
            Loading editor…
          </div>
        ) : (
          <MDXEditor
            ref={editorRef}
            markdown={markdown}
            onChange={handleChange}
            readOnly={readOnly}
            placeholder={placeholder}
            className="!border-0 !bg-transparent"
            contentEditableClassName="prose-markdown-canvas"
            plugins={plugins}
          />
        )}
      </div>
    </ScrollArea>
  )
}
