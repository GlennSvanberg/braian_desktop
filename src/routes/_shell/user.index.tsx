import { createFileRoute } from '@tanstack/react-router'
import { useSyncExternalStore } from 'react'

import { ChatWorkbench } from '@/components/app/chat-workbench'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useThemePreference } from '@/hooks/use-theme-preference'
import {
  formatUserProfileForPrompt,
  userProfileGet,
  userProfileSubscribe,
} from '@/lib/user-profile-api'
import type { ThemePreference } from '@/lib/theme-preference'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_shell/user/')({
  component: UserPage,
})

function useUserProfileSnapshot() {
  return useSyncExternalStore(userProfileSubscribe, userProfileGet, userProfileGet)
}

function AppearanceSection() {
  const { preference, setPreference, ready } = useThemePreference()

  return (
    <div
      className={cn(
        'border-border bg-card/50 rounded-xl border p-4 md:p-5',
      )}
    >
      <h2 className="text-text-2 mb-2 text-xs font-semibold tracking-wide uppercase">
        Appearance
      </h2>
      <p className="text-text-3 mb-3 text-sm leading-relaxed">
        Choose light, dark, or match your system. System follows your OS color
        scheme.
      </p>
      {!ready ? (
        <div className="bg-muted h-9 max-w-sm animate-pulse rounded-lg" />
      ) : (
        <Tabs
          value={preference}
          onValueChange={(v) => setPreference(v as ThemePreference)}
        >
          <TabsList className="grid w-full max-w-md grid-cols-3">
            <TabsTrigger value="light">Light</TabsTrigger>
            <TabsTrigger value="dark">Dark</TabsTrigger>
            <TabsTrigger value="auto">System</TabsTrigger>
          </TabsList>
          <TabsContent value="light" className="hidden" aria-hidden />
          <TabsContent value="dark" className="hidden" aria-hidden />
          <TabsContent value="auto" className="hidden" aria-hidden />
        </Tabs>
      )}
    </div>
  )
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
        <AppearanceSection />
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
