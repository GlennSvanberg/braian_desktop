import { Check, ChevronDown, ChevronUp, Loader2 } from 'lucide-react'
import {
  Children,
  isValidElement,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { ChatWorkspaceFileReference } from '@/components/app/chat-workspace-file-reference'
import type {
  AssistantChatMessage,
  AssistantPart,
  AssistantThinkingPart,
  AssistantToolPart,
} from '@/lib/chat-sessions/types'
import {
  looksLikeRelativeWorkspacePath,
  normalizeWorkspaceRelativePath,
} from '@/lib/chat-workspace-file-detect'
import { cn } from '@/lib/utils'

/** When set (Tauri + workspace root), assistant markdown can show file actions on path-like code. */
export type ChatWorkspaceFileMarkdownContext = {
  workspaceRootPath: string
  isDesktop: boolean
} | null

function markdownCodeLang(className: string | undefined): string | undefined {
  if (!className) return undefined
  const m = /(?:^|\s)language-([\w-]+)/.exec(className)
  return m?.[1]
}

function createWorkspaceFileMarkdownComponents(
  ctx: ChatWorkspaceFileMarkdownContext,
): Components | undefined {
  if (!ctx?.isDesktop || !ctx.workspaceRootPath) return undefined
  const { workspaceRootPath } = ctx

  return {
    pre({ children, ...props }) {
      const arr = Children.toArray(children)
      if (arr.length === 1 && isValidElement(arr[0]) && arr[0].type === 'code') {
        const cp = arr[0].props as {
          className?: string
          children?: ReactNode
        }
        const rawFull = String(cp.children ?? '')
        const raw = rawFull.replace(/\n$/, '').trim()
        const lang = markdownCodeLang(cp.className)
        if (
          !raw.includes('\n') &&
          (!lang || lang === 'text' || lang === 'path') &&
          looksLikeRelativeWorkspacePath(raw)
        ) {
          return (
            <ChatWorkspaceFileReference
              variant="block"
              relativePath={normalizeWorkspaceRelativePath(raw)}
              workspaceRootPath={workspaceRootPath}
            />
          )
        }
      }
      return <pre {...props}>{children}</pre>
    },
    code({ className, children, ...props }) {
      const rawFull = String(children ?? '')
      const raw = rawFull.replace(/\n$/, '').trim()
      if (raw.includes('\n')) {
        return (
          <code className={className} {...props}>
            {children}
          </code>
        )
      }
      const lang = markdownCodeLang(className)
      if (lang && lang !== 'text' && lang !== 'path') {
        return (
          <code className={className} {...props}>
            {children}
          </code>
        )
      }
      if (!looksLikeRelativeWorkspacePath(raw)) {
        return (
          <code className={className} {...props}>
            {children}
          </code>
        )
      }
      if (rawFull.endsWith('\n')) {
        return (
          <code className={className} {...props}>
            {children}
          </code>
        )
      }
      return (
        <ChatWorkspaceFileReference
          variant="inline"
          relativePath={normalizeWorkspaceRelativePath(raw)}
          workspaceRootPath={workspaceRootPath}
        />
      )
    },
  }
}

const STREAM_MARKDOWN_THROTTLE_MS = 80
const STREAM_MARKDOWN_THROTTLE_AFTER_CHARS = 280

function useStreamText(text: string, streaming: boolean) {
  const [out, setOut] = useState(text)
  const timeoutRef = useRef<number | null>(null)
  const lastFlushAtRef = useRef(0)

  useEffect(() => {
    if (timeoutRef.current != null) {
      window.clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }

    if (!streaming) {
      setOut(text)
      lastFlushAtRef.current = 0
      return
    }

    const throttleMs =
      text.length >= STREAM_MARKDOWN_THROTTLE_AFTER_CHARS
        ? STREAM_MARKDOWN_THROTTLE_MS
        : 0
    if (throttleMs === 0) {
      setOut(text)
      lastFlushAtRef.current = performance.now()
      return
    }

    const now = performance.now()
    const elapsed = now - lastFlushAtRef.current
    if (elapsed >= throttleMs || lastFlushAtRef.current === 0) {
      setOut(text)
      lastFlushAtRef.current = now
      return
    }

    const waitFor = throttleMs - elapsed
    timeoutRef.current = window.setTimeout(() => {
      setOut(text)
      lastFlushAtRef.current = performance.now()
      timeoutRef.current = null
    }, waitFor)

    return () => {
      if (timeoutRef.current != null) {
        window.clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
    }
  }, [text, streaming])

  return streaming ? out : text
}

function lastTextPartIndex(parts: AssistantPart[]): number {
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i]!.type === 'text') return i
  }
  return -1
}

function ChatMarkdownBlock({
  text,
  debounce,
  workspaceFileContext = null,
}: {
  text: string
  debounce: boolean
  workspaceFileContext?: ChatWorkspaceFileMarkdownContext
}) {
  const display = useStreamText(text, debounce)
  const components = useMemo(
    () => createWorkspaceFileMarkdownComponents(workspaceFileContext),
    [workspaceFileContext],
  )
  if (!display.trim()) return null
  return (
    <div className="chat-message-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        {...(components ? { components } : {})}
      >
        {display}
      </ReactMarkdown>
    </div>
  )
}

const toolCallPreBase =
  'rounded-md border border-border/40 bg-muted/25 p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words'

const toolCallPreVariants = {
  args: 'text-text-3',
  result: 'text-text-2',
} as const

/** Pretty-print when the payload is a JSON object or array; otherwise return unchanged. */
function formatToolPayloadText(raw: string): string {
  const t = raw.trim()
  if (t.length === 0) return raw
  const c = t[0]
  if (c !== '{' && c !== '[') return raw
  try {
    return JSON.stringify(JSON.parse(t), null, 2)
  } catch {
    return raw
  }
}

function ToolRowStatus({ streaming }: { streaming: boolean }) {
  if (streaming) {
    return (
      <span
        className="flex size-7 shrink-0 items-center justify-center"
        title="Running"
      >
        <Loader2
          className="text-text-1 size-4 shrink-0 animate-spin"
          aria-hidden
        />
        <span className="sr-only">Running</span>
      </span>
    )
  }
  return (
    <span
      className="border-accent-500/40 bg-accent-500/10 flex size-7 shrink-0 items-center justify-center rounded-full border"
      title="Done"
    >
      <Check className="text-accent-500 size-3.5 shrink-0" aria-hidden />
      <span className="sr-only">Done</span>
    </span>
  )
}

function ThinkingPartCard({ part }: { part: AssistantThinkingPart }) {
  const streaming = part.status === 'streaming'
  const [expanded, setExpanded] = useState(streaming)

  useEffect(() => {
    if (streaming) setExpanded(true)
  }, [streaming])

  const hasBody = part.text.trim().length > 0

  return (
    <div className="chat-tool-call text-text-3 text-xs leading-relaxed">
      <button
        type="button"
        className={cn(
          'group flex w-full min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-left',
          'text-text-2 font-medium tracking-tight',
          'hover:bg-muted/50 focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
        )}
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
      >
        {expanded ? (
          <ChevronUp
            aria-hidden
            className="text-text-3 size-3.5 shrink-0"
          />
        ) : (
          <ChevronDown
            aria-hidden
            className="text-text-3 size-3.5 shrink-0"
          />
        )}
        <span className="min-w-0 truncate">Thinking</span>
        <span className="ml-auto shrink-0">
          <ToolRowStatus streaming={streaming} />
        </span>
      </button>
      {expanded && hasBody ? (
        <pre
          className={cn(
            toolCallPreBase,
            'text-text-2 mt-2 max-h-64 overflow-auto',
          )}
        >
          {part.text}
        </pre>
      ) : null}
      {expanded && !hasBody && streaming ? (
        <p className="text-text-3 mt-2 text-[11px] italic">
          Working through the problem…
        </p>
      ) : null}
    </div>
  )
}

function ToolCallSectionLabel({ children }: { children: string }) {
  return (
    <p className="text-text-3 mb-1 text-[10px] font-semibold tracking-wide uppercase">
      {children}
    </p>
  )
}

function ToolCallExpandablePre({
  text,
  sectionClassName,
  variant,
}: {
  text: string
  sectionClassName?: string
  variant: keyof typeof toolCallPreVariants
}) {
  const [expanded, setExpanded] = useState(false)
  const [hasOverflow, setHasOverflow] = useState(false)
  const preRef = useRef<HTMLPreElement>(null)
  const displayText = useMemo(() => formatToolPayloadText(text), [text])

  useLayoutEffect(() => {
    const el = preRef.current
    if (!el) return
    const measure = () => {
      if (expanded) return
      setHasOverflow(el.scrollHeight > el.clientHeight + 1)
    }
    const id = requestAnimationFrame(measure)
    return () => cancelAnimationFrame(id)
  }, [displayText, expanded])

  const showToggle = hasOverflow || expanded

  return (
    <div className={sectionClassName}>
      <pre
        ref={preRef}
        className={cn(
          toolCallPreBase,
          toolCallPreVariants[variant],
          !expanded && 'line-clamp-3 overflow-hidden',
        )}
      >
        {displayText}
      </pre>
      {showToggle ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={expanded ? 'Show less' : 'Show more'}
          title={expanded ? 'Show less' : 'Show more'}
          className="text-text-3 hover:text-text-1 mt-1.5 inline-flex items-center rounded-md p-0.5 transition-colors hover:bg-muted/50 focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none"
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? (
            <ChevronUp className="size-4" aria-hidden />
          ) : (
            <ChevronDown className="size-4" aria-hidden />
          )}
        </button>
      ) : null}
    </div>
  )
}

function ToolCallCard({ part }: { part: AssistantToolPart }) {
  const streaming = part.status === 'streaming'
  const [expanded, setExpanded] = useState(false)

  const hasDetails =
    Boolean(part.argsText) ||
    Boolean(part.result) ||
    streaming

  return (
    <div className="chat-tool-call rounded-md">
      <div className="flex items-center justify-between gap-2">
        {hasDetails ? (
          <button
            type="button"
            aria-expanded={expanded}
            className={cn(
              'group flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-1.5 text-left',
              'text-text-3 font-mono text-xs font-medium tracking-tight',
              'hover:bg-muted/50 focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
            )}
            onClick={() => setExpanded((e) => !e)}
          >
            {expanded ? (
              <ChevronUp
                aria-hidden
                className="text-text-3 size-3.5 shrink-0"
              />
            ) : (
              <ChevronDown
                aria-hidden
                className="text-text-3 size-3.5 shrink-0"
              />
            )}
            <span className="min-w-0 truncate">{part.toolName}</span>
          </button>
        ) : (
          <span className="text-text-3 min-w-0 flex-1 truncate px-2 py-1.5 font-mono text-xs font-medium tracking-tight">
            {part.toolName}
          </span>
        )}
        <ToolRowStatus streaming={streaming} />
      </div>
      {expanded ? (
        <div className="mt-2 border-t border-border/40 pt-2">
          {part.argsText ? (
            <div>
              <ToolCallSectionLabel>Arguments</ToolCallSectionLabel>
              <ToolCallExpandablePre text={part.argsText} variant="args" />
            </div>
          ) : streaming ? (
            <p className="text-text-3 text-xs italic">Receiving arguments…</p>
          ) : null}
          {part.result ? (
            <div
              className={cn(
                part.argsText || streaming ? 'mt-2 border-t border-border/40 pt-2' : '',
              )}
            >
              <ToolCallSectionLabel>Result</ToolCallSectionLabel>
              <ToolCallExpandablePre text={part.result} variant="result" />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function ChatUserMessageBody({ content }: { content: string }) {
  return (
    <p className="text-text-1 whitespace-pre-wrap break-words">
      {content}
    </p>
  )
}

export function ChatAssistantMessageBody({
  message,
  workspaceFileContext = null,
}: {
  message: AssistantChatMessage
  workspaceFileContext?: ChatWorkspaceFileMarkdownContext
}) {
  const streaming = message.status === 'streaming'
  const parts = message.parts

  if (!parts || parts.length === 0) {
    if (!message.content) {
      return streaming ? (
        <span className="text-text-3 italic">…</span>
      ) : null
    }
    return (
      <ChatMarkdownBlock
        text={message.content}
        debounce={streaming}
        workspaceFileContext={workspaceFileContext}
      />
    )
  }

  const lastTextIdx = lastTextPartIndex(parts)

  return (
    <div className="flex flex-col gap-2.5">
      {parts.map((part, i) => {
        if (part.type === 'tool') {
          return <ToolCallCard key={part.toolCallId} part={part} />
        }
        if (part.type === 'thinking') {
          return <ThinkingPartCard key={`thinking-${i}`} part={part} />
        }
        const debounce = streaming && i === lastTextIdx
        return (
          <ChatMarkdownBlock
            key={`text-${i}`}
            text={part.text}
            debounce={debounce}
            workspaceFileContext={workspaceFileContext}
          />
        )
      })}
    </div>
  )
}

/** Plaintext for clipboard: assistant visible text only (no tool JSON). */
export function assistantPlainTextForCopy(message: AssistantChatMessage): string {
  if (!message.parts?.length) return message.content
  return message.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('\n\n')
}
