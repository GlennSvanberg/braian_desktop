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

const MARKDOWN_DEBOUNCE_MS = 80

function useDebouncedText(text: string, enabled: boolean) {
  const [out, setOut] = useState(text)
  useEffect(() => {
    if (!enabled) {
      setOut(text)
      return
    }
    const t = window.setTimeout(() => setOut(text), MARKDOWN_DEBOUNCE_MS)
    return () => window.clearTimeout(t)
  }, [text, enabled])
  return enabled ? out : text
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
  const display = useDebouncedText(text, debounce)
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
  'rounded-md border p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words'

const toolCallPreVariants = {
  args: 'border-border/50 bg-muted/20 text-text-3',
  result: 'border-accent-500/25 bg-bg-2/90 text-text-2 ring-1 ring-inset ring-border/40',
} as const

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

  useLayoutEffect(() => {
    const el = preRef.current
    if (!el) return
    const measure = () => {
      if (expanded) return
      setHasOverflow(el.scrollHeight > el.clientHeight + 1)
    }
    const id = requestAnimationFrame(measure)
    return () => cancelAnimationFrame(id)
  }, [text, expanded])

  const showToggle = hasOverflow || expanded

  return (
    <div className={sectionClassName}>
      <pre
        ref={preRef}
        className={cn(
          toolCallPreBase,
          toolCallPreVariants[variant],
          !expanded && 'line-clamp-2 overflow-hidden',
        )}
      >
        {text}
      </pre>
      {showToggle ? (
        <button
          type="button"
          aria-expanded={expanded}
          className={cn(
            'mt-1.5 text-xs font-medium underline-offset-2 hover:underline',
            variant === 'args'
              ? 'text-text-3 hover:text-accent-600'
              : 'text-accent-600/90 hover:text-accent-500',
          )}
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      ) : null}
    </div>
  )
}

function ToolCallCard({ part }: { part: AssistantToolPart }) {
  const streaming = part.status === 'streaming'
  return (
    <div
      className={cn(
        'chat-tool-call bg-muted/25 rounded-lg border border-border border-l-2 border-l-accent-500/55 px-2.5 py-2 shadow-sm',
        streaming && 'border-accent-500/35',
      )}
    >
      <div className="border-border/70 flex items-start justify-between gap-2 border-b pb-2">
        <span className="text-accent-500 font-mono text-xs font-semibold tracking-tight">
          {part.toolName}
        </span>
        <span
          className={cn(
            'shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold',
            streaming
              ? 'bg-warning/15 text-warning'
              : 'bg-accent-500/12 text-accent-600',
          )}
        >
          {streaming ? 'Running…' : 'Done'}
        </span>
      </div>
      {part.argsText ? (
        <div className="mt-2">
          <ToolCallSectionLabel>Arguments</ToolCallSectionLabel>
          <ToolCallExpandablePre text={part.argsText} variant="args" />
        </div>
      ) : streaming ? (
        <p className="text-text-3 mt-2 text-xs italic">Receiving arguments…</p>
      ) : null}
      {part.result ? (
        <div className="mt-2 border-border/60 border-t pt-2">
          <ToolCallSectionLabel>Result</ToolCallSectionLabel>
          <ToolCallExpandablePre text={part.result} variant="result" />
        </div>
      ) : null}
    </div>
  )
}

export function ChatUserMessageBody({ content }: { content: string }) {
  return (
    <p className="text-primary-foreground whitespace-pre-wrap break-words">
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
