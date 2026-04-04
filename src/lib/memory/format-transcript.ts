import type {
  AssistantChatMessage,
  AssistantPart,
  ChatMessage,
} from '@/lib/chat-sessions/types'

function clip(s: string, max: number): string {
  if (s.length <= max) return s
  return `${s.slice(0, max)}…`
}

function formatToolParts(parts: AssistantPart[] | undefined): string {
  if (!parts?.length) return ''
  const lines: string[] = []
  for (const p of parts) {
    if (p.type === 'text' && p.text.trim()) {
      lines.push(p.text)
    } else if (p.type === 'tool') {
      const args = clip(p.argsText.trim(), 2000)
      const res = p.result != null ? clip(String(p.result), 8000) : ''
      lines.push(
        `[tool ${p.toolName}${args ? ` args: ${args}` : ''}]${res ? `\nresult: ${res}` : ''}`,
      )
    }
  }
  return lines.join('\n\n')
}

function formatAssistantMessage(m: AssistantChatMessage): string {
  const fromParts = formatToolParts(m.parts)
  const body = m.content.trim()
  if (fromParts && body) return `${body}\n\n${fromParts}`
  if (fromParts) return fromParts
  return body
}

/**
 * Linear transcript for the memory reviewer (roles + tool traces when present).
 */
export function formatMessagesForMemoryReview(messages: ChatMessage[]): string {
  const blocks: string[] = []
  for (const m of messages) {
    if (m.role === 'user') {
      blocks.push(`--- user ---\n${m.content.trim()}`)
    } else {
      blocks.push(`--- assistant ---\n${formatAssistantMessage(m)}`)
    }
  }
  return blocks.join('\n\n')
}
