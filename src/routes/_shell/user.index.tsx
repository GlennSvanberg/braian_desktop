import { createFileRoute } from '@tanstack/react-router'
import { useSyncExternalStore } from 'react'

import { ChatWorkbench } from '@/components/app/chat-workbench'
import {
  formatUserProfileForPrompt,
  userProfileGet,
  userProfileSubscribe,
} from '@/lib/user-profile-api'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_shell/user/')({
  component: UserPage,
})

function useUserProfileSnapshot() {
  return useSyncExternalStore(userProfileSubscribe, userProfileGet, userProfileGet)
}

function UserPage() {
  const profile = useUserProfileSnapshot()
  const summary = formatUserProfileForPrompt(profile)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4 md:p-6">
      <div className="mx-auto w-full max-w-4xl space-y-4">
        <header className="space-y-1">
          <h1 className="text-text-1 text-xl font-semibold tracking-tight md:text-2xl">
            You
          </h1>
          <p className="text-text-3 text-sm leading-relaxed md:text-base">
            Chat below to teach Braian about yourself. What you save is added to
            every workspace chat as context (name, location, languages, notes).
          </p>
        </header>
        <div
          className={cn(
            'border-border bg-card/50 rounded-xl border p-4 md:p-5',
          )}
        >
          <h2 className="text-text-2 mb-2 text-xs font-semibold tracking-wide uppercase">
            Saved profile summary
          </h2>
          <pre className="text-text-2 font-sans text-sm leading-relaxed whitespace-pre-wrap">
            {summary}
          </pre>
        </div>
        <div className="border-border flex min-h-[min(70dvh,640px)] flex-1 flex-col overflow-hidden rounded-xl border md:min-h-[min(72dvh,720px)]">
          <ChatWorkbench
            conversationId={null}
            variant="profile"
          />
        </div>
      </div>
    </div>
  )
}
