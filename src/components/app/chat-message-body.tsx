import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import type {
  AssistantChatMessage,
  AssistantPart,
  AssistantToolPart,
} from '@/lib/chat-sessions/types'
import { cn } from '@/lib/utils'

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
}: {
  text: string
  debounce: boolean
}) {
  const display = useDebouncedText(text, debounce)
  if (!display.trim()) return null
  return (
    <div className="chat-message-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{display}</ReactMarkdown>
    </div>
  )
}

function ToolCallCard({ part }: { part: AssistantToolPart }) {
  return (
    <div
      className={cn(
        'chat-tool-call border-border bg-muted/35 rounded-lg border px-2.5 py-2',
        part.status === 'streaming' && 'border-accent-500/30',
      )}
    >
      <div className="text-text-1 flex items-center justify-between gap-2 text-xs font-medium">
        <span className="font-mono tracking-tight">{part.toolName}</span>
        <span className="text-text-3 shrink-0">
          {part.status === 'streaming' ? 'Running…' : 'Done'}
        </span>
      </div>
      {part.argsText ? (
        <pre className="text-text-2 mt-1.5 max-h-36 overflow-auto rounded-md border border-border bg-bg-2 p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words">
          {part.argsText}
        </pre>
      ) : part.status === 'streaming' ? (
        <p className="text-text-3 mt-1 text-xs italic">Receiving arguments…</p>
      ) : null}
      {part.result ? (
        <p className="text-text-3 mt-1.5 border-border border-t pt-1.5 text-xs leading-relaxed">
          {part.result}
        </p>
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
}: {
  message: AssistantChatMessage
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
      <ChatMarkdownBlock text={message.content} debounce={streaming} />
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
