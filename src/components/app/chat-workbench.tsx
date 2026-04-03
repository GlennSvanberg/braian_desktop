import { CornerDownLeft, Loader2, Sparkles } from 'lucide-react'
import { useCallback, useEffect } from 'react'

import { ArtifactPanel } from '@/components/app/artifact-panel'
import { useWorkspace } from '@/components/app/workspace-context'
import { Button } from '@/components/ui/button'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { useIsMobile } from '@/hooks/use-mobile'
import { chatSessionKey } from '@/lib/chat-sessions/keys'
import {
  seedCanvasPreviewIfEmpty,
  useChatThread,
  useChatThreadActions,
} from '@/lib/chat-sessions/store'
import { getConversationById } from '@/lib/mock-workspace-data'
import type { ConversationDto } from '@/lib/workspace-api'
import { cn } from '@/lib/utils'

function normalizeCanvasKind(
  s: string | undefined,
): 'document' | 'tabular' | 'visual' {
  if (s === 'tabular' || s === 'visual') return s
  return 'document'
}

type ChatWorkbenchProps = {
  /** Conversation id from the sidebar, or `null` for a fresh “new chat” session. */
  conversationId: string | null
  /** When set (saved chat from DB), drives title and canvas kind for previews. */
  conversationMeta?: ConversationDto | null
}

export function ChatWorkbench({
  conversationId,
  conversationMeta,
}: ChatWorkbenchProps) {
  const { activeWorkspaceId } = useWorkspace()
  const sessionKey = chatSessionKey(activeWorkspaceId, conversationId)
  const thread = useChatThread(sessionKey)
  const { sendChatTurn, setChatDraft, patchDocumentArtifactBody } =
    useChatThreadActions()

  const saved = conversationId
    ? getConversationById(conversationId)
    : undefined
  const chatTitle =
    conversationMeta?.title ?? saved?.title ?? 'New chat'
  const isNewChat = conversationId === null

  const isMobile = useIsMobile()
  const { messages, artifactOpen, artifactPayload, draft, generating } = thread

  useEffect(() => {
    seedCanvasPreviewIfEmpty(sessionKey, conversationId, {
      title: conversationMeta?.title,
      canvasKind: conversationMeta
        ? normalizeCanvasKind(conversationMeta.canvasKind)
        : undefined,
    })
  }, [sessionKey, conversationId, conversationMeta])

  const sendMessage = useCallback(() => {
    sendChatTurn(sessionKey, draft)
  }, [draft, sendChatTurn, sessionKey])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const helperSubtitle = artifactOpen
    ? 'Workspace canvas is open · resize the split or keep typing below.'
    : 'Primary assistant replies stream here. Configure your API key under Settings. Dev mock: localStorage braian.mockAi = 1.'

  const chatColumn = (
    <div
      className={cn(
        'bg-background flex h-full min-h-0 flex-col',
        !artifactOpen && 'flex-1',
        artifactOpen && !isMobile && 'md:rounded-l-xl',
        artifactOpen && isMobile && 'min-h-[min(100dvh,520px)]',
        !artifactOpen && 'md:rounded-xl md:border md:border-border',
      )}
    >
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-6 px-4 py-5 md:px-5">
          <div className="flex items-start gap-3">
            <div className="bg-accent-500/15 text-accent-600 border-accent-500/25 flex size-9 shrink-0 items-center justify-center rounded-full border">
              <Sparkles className="size-4" />
            </div>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex items-center gap-2">
                <p className="text-text-1 text-sm font-medium">{chatTitle}</p>
                {generating ? (
                  <span className="text-text-3 inline-flex items-center gap-1.5 text-xs">
                    <Loader2
                      className="size-3.5 shrink-0 animate-spin opacity-80"
                      aria-hidden
                    />
                    <span className="sr-only">Assistant is replying</span>
                    <span className="hidden sm:inline">Working…</span>
                  </span>
                ) : null}
              </div>
              <p className="text-text-3 mt-1 text-xs leading-relaxed">
                {helperSubtitle}
              </p>
            </div>
          </div>
          {messages.length === 0 ? (
            <div className="border-border bg-muted/25 text-text-3 rounded-xl border border-dashed px-4 py-8 text-center text-sm leading-relaxed">
              {isNewChat
                ? 'New conversation. Send a message to start; the workspace panel opens beside chat when you have a canvas.'
                : 'This thread starts empty. Send a message to chat with the assistant.'}
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={cn(
                    'flex',
                    m.role === 'user' ? 'justify-end' : 'justify-start',
                  )}
                >
                  <div
                    className={cn(
                      'max-w-[min(100%,42rem)] rounded-2xl border px-3.5 py-2.5 text-sm leading-relaxed shadow-sm',
                      m.role === 'user'
                        ? 'bg-primary text-primary-foreground border-primary/20 rounded-tr-md'
                        : 'bg-card text-text-2 border-border rounded-tl-md',
                      m.role === 'assistant' &&
                        m.status === 'streaming' &&
                        !m.content &&
                        'text-text-3 italic',
                    )}
                  >
                    {m.content ||
                      (m.role === 'assistant' && m.status === 'streaming'
                        ? '…'
                        : '')}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
      <div className="border-border bg-background/95 supports-backdrop-filter:bg-background/80 shrink-0 border-t p-3 backdrop-blur-md md:p-4">
        <div className="bg-card border-border focus-within:ring-ring/40 relative rounded-xl border shadow-sm focus-within:ring-2">
          <Textarea
            placeholder="Message Braian…"
            value={draft}
            onChange={(e) => setChatDraft(sessionKey, e.target.value)}
            onKeyDown={onKeyDown}
            disabled={generating}
            className="min-h-[88px] resize-none border-0 bg-transparent px-3.5 py-3 text-sm shadow-none focus-visible:ring-0 disabled:opacity-60"
          />
          <div className="flex items-center justify-between gap-2 px-2 pb-2">
            <p className="text-text-3 px-1.5 text-xs">
              Enter to send · Shift+Enter for newline
            </p>
            <Button
              type="button"
              size="sm"
              className="gap-1.5"
              onClick={sendMessage}
              disabled={!draft.trim() || generating}
            >
              Send
              <CornerDownLeft className="size-3.5 opacity-80" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-0 md:gap-2 md:p-2">
      {!artifactOpen ? (
        <div className="flex min-h-0 flex-1 flex-col">{chatColumn}</div>
      ) : (
        <ResizablePanelGroup
          direction={isMobile ? 'vertical' : 'horizontal'}
          className="min-h-0 flex-1 rounded-none md:rounded-xl md:border md:border-border"
        >
          <ResizablePanel
            defaultSize={isMobile ? 52 : 42}
            minSize={isMobile ? 30 : 28}
            className="min-h-0 min-w-0"
          >
            {chatColumn}
          </ResizablePanel>
          <ResizableHandle
            withHandle
            className={cn('bg-border', isMobile ? 'flex' : 'hidden md:flex')}
          />
          <ResizablePanel
            defaultSize={isMobile ? 48 : 58}
            minSize={isMobile ? 25 : 32}
            className="min-h-0 min-w-0"
          >
            <div
              className={cn(
                'h-full min-h-0 p-2 md:p-3',
                isMobile ? 'bg-muted/20 min-h-[280px]' : 'bg-muted/30 md:bg-transparent',
                !isMobile && 'md:rounded-r-xl',
              )}
            >
              <ArtifactPanel
                payload={artifactPayload}
                onDocumentBodyChange={(body) =>
                  patchDocumentArtifactBody(sessionKey, body)
                }
              />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
    </div>
  )
}
