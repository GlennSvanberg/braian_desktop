import { CornerDownLeft, Sparkles } from 'lucide-react'
import { useCallback, useState } from 'react'

import { ArtifactPanel } from '@/components/app/artifact-panel'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { useIsMobile } from '@/hooks/use-mobile'
import { getConversationById } from '@/lib/mock-workspace-data'
import { cn } from '@/lib/utils'

type ChatRole = 'user' | 'assistant'

type ChatMessage = {
  id: string
  role: ChatRole
  content: string
}

function createId() {
  return `m-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

type ChatWorkbenchProps = {
  /** Mock conversation id from the sidebar, or `null` for a fresh “new chat” session. */
  conversationId: string | null
}

export function ChatWorkbench({ conversationId }: ChatWorkbenchProps) {
  const saved = conversationId
    ? getConversationById(conversationId)
    : undefined
  const chatTitle = saved?.title ?? 'New chat'
  const isNewChat = conversationId === null

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [artifactOpen, setArtifactOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const isMobile = useIsMobile()

  const sendMessage = useCallback(() => {
    const text = draft.trim()
    if (!text) return

    const userMsg: ChatMessage = {
      id: createId(),
      role: 'user',
      content: text,
    }
    const assistantMsg: ChatMessage = {
      id: createId(),
      role: 'assistant',
      content:
        'Here’s a first pass. The artifact panel is open so you can review the structured draft alongside this thread.',
    }
    setDraft('')
    setMessages((prev) => [...prev, userMsg, assistantMsg])
    setArtifactOpen(true)
  }, [draft])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const artifactTitle = isNewChat
    ? 'Untitled artifact'
    : `${chatTitle} · draft`

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
            <div className="min-w-0 pt-0.5">
              <p className="text-text-1 text-sm font-medium">{chatTitle}</p>
              <p className="text-text-3 mt-1 text-xs leading-relaxed">
                {artifactOpen
                  ? 'Artifact is open · resize the split or keep typing below.'
                  : 'Chat only for now—the assistant will open an artifact when your first message needs one.'}
              </p>
            </div>
          </div>
          {messages.length === 0 ? (
            <div className="border-border bg-muted/25 text-text-3 rounded-xl border border-dashed px-4 py-8 text-center text-sm leading-relaxed">
              {isNewChat
                ? 'New conversation. Send a message to start; an artifact pane will appear when there’s something to show beside the thread.'
                : 'This thread starts empty. Send a message to continue—the artifact panel opens once the reply includes a draft to inspect.'}
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={cn(
                    'flex gap-3',
                    m.role === 'user' ? 'flex-row-reverse' : 'flex-row',
                  )}
                >
                  <Avatar
                    className={cn(
                      'size-8 shrink-0',
                      m.role === 'user'
                        ? 'bg-primary/15'
                        : 'bg-muted border border-border',
                    )}
                  >
                    <AvatarFallback
                      className={cn(
                        'text-xs font-semibold',
                        m.role === 'user'
                          ? 'text-primary'
                          : 'text-muted-foreground',
                      )}
                    >
                      {m.role === 'user' ? 'You' : 'AI'}
                    </AvatarFallback>
                  </Avatar>
                  <div
                    className={cn(
                      'max-w-[min(100%,42rem)] rounded-2xl border px-3.5 py-2.5 text-sm leading-relaxed shadow-sm',
                      m.role === 'user'
                        ? 'bg-primary text-primary-foreground border-primary/20 rounded-tr-md'
                        : 'bg-card text-text-2 border-border rounded-tl-md',
                    )}
                  >
                    {m.content}
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
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            className="min-h-[88px] resize-none border-0 bg-transparent px-3.5 py-3 text-sm shadow-none focus-visible:ring-0"
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
              disabled={!draft.trim()}
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
              <ArtifactPanel title={artifactTitle} />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
    </div>
  )
}
