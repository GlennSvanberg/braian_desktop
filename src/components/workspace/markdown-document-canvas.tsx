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

import { ScrollArea } from '@/components/ui/scroll-area'
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

export type MarkdownDocumentCanvasProps = {
  markdown: string
  onMarkdownChange?: (next: string) => void
  readOnly?: boolean
  className?: string
  placeholder?: ReactNode
}

export function MarkdownDocumentCanvas({
  markdown,
  onMarkdownChange,
  readOnly = false,
  className,
  placeholder = 'Start writing…',
}: MarkdownDocumentCanvasProps) {
  const [mounted, setMounted] = useState(false)
  const editorRef = useRef<MDXEditorMethods>(null)
  const lastSyncedRef = useRef(markdown)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
    }
  }, [markdown])

  const flushDebounced = useCallback(() => {
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
  }, [])

  useEffect(() => () => flushDebounced(), [flushDebounced])

  const handleChange = useCallback(
    (next: string, initialMarkdownNormalize: boolean) => {
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

  return (
    <ScrollArea className={cn('min-h-0 flex-1', className)}>
      <div
        className={cn(
          'markdown-document-canvas bg-background border-border text-text-2 mx-auto max-w-2xl rounded-lg border px-2 py-3 shadow-sm md:px-4 md:py-4',
          isDark ? 'dark-theme' : 'light-theme',
        )}
      >
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
