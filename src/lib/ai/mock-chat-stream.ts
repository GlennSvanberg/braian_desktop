import { getMockArtifactPayloadForChat } from '@/lib/artifacts'

import type { ChatStreamChunk, ChatTurnContext } from './types'

function delay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new DOMException('Aborted', 'AbortError'),
      )
      return
    }
    const id = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      window.clearTimeout(id)
      reject(
        signal?.reason instanceof Error
          ? signal.reason
          : new DOMException('Aborted', 'AbortError'),
      )
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

const MOCK_REPLIES = [
  'Got it. Here is a quick thought you can riff on.',
  'Interesting angle — I would probe one level deeper on the constraints.',
  'Short answer: yes, with a few caveats worth spelling out.',
  'Let me mirror that back in simpler terms so we stay aligned.',
  'If you want, we can turn this into a checklist next.',
  'That maps to three moves: clarify, narrow, then ship a thin slice.',
]

function pickRandomReply(): string {
  return MOCK_REPLIES[Math.floor(Math.random() * MOCK_REPLIES.length)]!
}

function splitForStreaming(text: string): string[] {
  const chunks: string[] = []
  const words = text.split(/(\s+)/)
  let buf = ''
  for (const w of words) {
    buf += w
    if (buf.length >= 12 || /\n\n$/.test(buf)) {
      chunks.push(buf)
      buf = ''
    }
  }
  if (buf) chunks.push(buf)
  return chunks.length ? chunks : [text]
}

const LONG_TRIGGER = /long/i

const LONG_RUN_MS = 60_000
const LONG_TICKS = 24

function canvasHint(kind: string): string {
  switch (kind) {
    case 'tabular':
      return 'Updated your data table on the right — same shape the live assistant will use for Excel/CSV views.'
    case 'tabular-multi':
      return 'Refreshed the data canvas with multiple tables — use this for several files or a merged sheet in one view.'
    case 'visual':
      return 'Refreshed the visual canvas — when image gen is wired, `imageSrc` will show the real bitmap.'
    case 'document':
    default:
      return 'Synced the document canvas — long-form text for specs and briefs, ChatGPT-canvas style.'
  }
}

export async function* streamMockChatTurn(
  userText: string,
  signal?: AbortSignal,
  context?: ChatTurnContext,
): AsyncGenerator<ChatStreamChunk> {
  const wantsLong = LONG_TRIGGER.test(userText)

  if (wantsLong) {
    signal?.throwIfAborted()
    yield {
      type: 'text-delta',
      text: 'Running a mock long task (about 1 minute). You can switch chats or workspaces; this continues in the background.',
    }
    for (let i = 0; i < LONG_TICKS; i++) {
      signal?.throwIfAborted()
      await delay(LONG_RUN_MS / LONG_TICKS, signal)
    }
  }

  if (context?.turnKind === 'profile') {
    signal?.throwIfAborted()
    const hints = /name|call me|i am|live in|from |language|prefer|norwegian|english/i.test(
      userText,
    )
    if (hints) {
      const mockToolId = `mock-profile-tool-${Date.now()}`
      yield {
        type: 'tool-start',
        toolCallId: mockToolId,
        toolName: 'update_user_profile',
      }
      yield {
        type: 'tool-args-delta',
        toolCallId: mockToolId,
        delta: '{"notes":"(mock mode) sample note"}',
      }
      await delay(35, signal)
      yield {
        type: 'tool-end',
        toolCallId: mockToolId,
        toolName: 'update_user_profile',
        input: { notes: '(mock mode) sample note' },
        result: JSON.stringify({
          ok: true,
          message: 'Profile updated (mock).',
        }),
      }
    }
    const replyText = hints
      ? 'Mock mode: simulated update_user_profile. With a real model, only that tool is available here and it merges into your saved profile.'
      : `${pickRandomReply()} Mock mode: this is the profile coach chat — in production only update_user_profile runs. Mention your name or languages to see a mock tool call.`
    const pieces = splitForStreaming(replyText)
    for (const piece of pieces) {
      signal?.throwIfAborted()
      yield { type: 'text-delta', text: piece }
      await delay(28 + Math.floor(Math.random() * 40), signal)
    }
    signal?.throwIfAborted()
    yield { type: 'done' }
    return
  }

  const isCodeMode =
    context?.agentMode === 'code' || context?.agentMode === 'app'
  const hasPersistedConversation =
    context?.conversationId != null && context.conversationId !== ''
  const payload = getMockArtifactPayloadForChat(
    context?.conversationId ?? null,
  )
  const fileHint =
    context?.contextFiles != null && context.contextFiles.length > 0
      ? ` (${context.contextFiles.length} attached file(s): ${context.contextFiles.map((f) => f.displayName?.trim() || f.relativePath).join(', ')}.)`
      : ''
  const chatHint =
    context?.contextPriorConversations != null &&
    context.contextPriorConversations.length > 0
      ? ` (${context.contextPriorConversations.length} prior chat(s): ${context.contextPriorConversations.map((c) => c.title).join(', ')}.)`
      : ''
  const replyText = isCodeMode
    ? `${pickRandomReply()}${fileHint}${chatHint} Mock mode: coding tools (read/write/run) are not simulated — use the real desktop app without braian.mockAi for workspace commands.`
    : hasPersistedConversation
      ? `${pickRandomReply()}${fileHint}${chatHint} ${canvasHint(payload.kind)}`
      : `${pickRandomReply()}${fileHint}${chatHint} Mock mode: the document canvas tool is only available for a saved conversation (persisted id). On desktop, use New chat from the sidebar so a conversation is created before you type; on /chat/new in the browser there is no canvas tool until you follow that flow.`

  signal?.throwIfAborted()
  if (!isCodeMode && hasPersistedConversation) {
    const mockToolId = `mock-tool-${Date.now()}`
    yield {
      type: 'tool-start',
      toolCallId: mockToolId,
      toolName: 'open_document_canvas',
    }
    yield {
      type: 'tool-args-delta',
      toolCallId: mockToolId,
      delta: '{"title":"Mock canvas","body":"# Hello from mock tool',
    }
    await delay(40, signal)
    yield {
      type: 'tool-args-delta',
      toolCallId: mockToolId,
      delta: '\\n\\nThis simulates streaming tool arguments."}',
    }
    await delay(50, signal)
    yield {
      type: 'tool-end',
      toolCallId: mockToolId,
      toolName: 'open_document_canvas',
      input: { title: 'Mock canvas', body: '# Hello…' },
    }
  }

  const pieces = splitForStreaming(replyText)
  for (const piece of pieces) {
    signal?.throwIfAborted()
    yield { type: 'text-delta', text: piece }
    await delay(28 + Math.floor(Math.random() * 40), signal)
  }

  signal?.throwIfAborted()
  if (!isCodeMode && hasPersistedConversation) {
    yield { type: 'artifact', payload }
  }

  signal?.throwIfAborted()
  yield { type: 'done' }
}
