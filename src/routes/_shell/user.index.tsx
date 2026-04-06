import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useSyncExternalStore } from 'react'

import { AiSettingsPanel } from '@/components/app/ai-settings-panel'
import { ChatWorkbench } from '@/components/app/chat-workbench'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useMinWidthXl } from '@/hooks/use-min-width-xl'
import { useThemePreference } from '@/hooks/use-theme-preference'
import {
  formatUserProfileForPrompt,
  userProfileGet,
  userProfileSubscribe,
} from '@/lib/user-profile-api'
import type { ThemePreference } from '@/lib/theme-preference'
import { cn } from '@/lib/utils'

export type UserPageTab = 'profile' | 'ai'

type UserSearch = {
  tab: UserPageTab
}

function parseUserTab(raw: Record<string, unknown>): UserPageTab {
  return raw.tab === 'ai' ? 'ai' : 'profile'
}

export const Route = createFileRoute('/_shell/user/')({
  validateSearch: (raw: Record<string, unknown>): UserSearch => ({
    tab: parseUserTab(raw),
  }),
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
  const { tab } = Route.useSearch()
  const navigate = useNavigate()
  const profile = useUserProfileSnapshot()
  const summary = formatUserProfileForPrompt(profile)
  const isWide = useMinWidthXl()

  const profileBlurb = isWide ? (
    <p className="text-text-3 text-sm leading-relaxed">
      Chat below to teach Braian about yourself (name, location, languages,
      notes). API keys and models are configured in the column to the right.
    </p>
  ) : (
    <p className="text-text-3 text-sm leading-relaxed">
      Chat below to teach Braian about yourself (name, location, languages,
      notes). API keys and models live under{' '}
      <span className="text-text-2 font-medium">AI &amp; models</span>.
    </p>
  )

  const profileBody = (
    <>
      {profileBlurb}
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
        <ChatWorkbench conversationId={null} variant="profile" />
      </div>
    </>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4 md:p-6">
      <div className="w-full space-y-4 md:space-y-6">
        <header className="space-y-1">
          <h1 className="text-text-1 text-xl font-semibold tracking-tight md:text-2xl">
            You
          </h1>
          <p className="text-text-3 text-sm leading-relaxed md:text-base">
            Profile, appearance, and global AI settings. Your saved profile is
            added to every workspace chat as context.
          </p>
        </header>

        {isWide ? (
          <div className="grid min-h-0 grid-cols-2 items-start gap-10">
            <section className="min-w-0 space-y-4" aria-labelledby="you-profile-heading">
              <h2
                id="you-profile-heading"
                className="text-text-1 text-base font-semibold tracking-tight"
              >
                Profile
              </h2>
              {profileBody}
            </section>
            <section
              className="border-border min-w-0 space-y-4 border-l pl-10"
              aria-label="AI and models"
            >
              <AiSettingsPanel embedded />
            </section>
          </div>
        ) : (
          <Tabs
            value={tab}
            onValueChange={(v) => {
              void navigate({
                to: '/user',
                search: { tab: v as UserPageTab },
                replace: true,
              })
            }}
          >
            <TabsList
              variant="line"
              className="h-auto w-full justify-start gap-1 rounded-none border-b border-border bg-transparent p-0"
            >
              <TabsTrigger value="profile">Profile</TabsTrigger>
              <TabsTrigger value="ai">AI &amp; models</TabsTrigger>
            </TabsList>
            <TabsContent value="profile" className="mt-4 space-y-4">
              {profileBody}
            </TabsContent>
            <TabsContent value="ai" className="mt-4">
              <AiSettingsPanel embedded />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  )
}
