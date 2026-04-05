import type { AssistantChatMessage, ChatMessage } from '@/lib/chat-sessions/types'

/** Include tool traces so follow-up turns stay grounded in prior workspace reads/runs. */
function assistantContentForLlmHistory(m: AssistantChatMessage): string {
  const parts = m.parts
  if (!parts?.length) return m.content
  const blocks: string[] = []
  for (const p of parts) {
    if (p.type === 'thinking') {
      continue
    }
    if (p.type === 'text' && p.text.trim()) {
      blocks.push(p.text)
    } else if (p.type === 'tool') {
      const bits = [`[Tool ${p.toolName}]`]
      if (p.argsText?.trim()) bits.push(`Input: ${p.argsText}`)
      if (p.result?.trim()) bits.push(`Output: ${p.result}`)
      blocks.push(bits.join('\n'))
    }
  }
  const merged = blocks.join('\n\n').trim()
  return merged || m.content
}

export function chatMessageContentForLlmHistory(m: ChatMessage): string {
  if (m.role === 'user') return m.content
  return assistantContentForLlmHistory(m)
}
