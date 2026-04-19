import { Link } from '@tanstack/react-router'

import { Button } from '@/components/ui/button'
import { desktopReleasesLatestPageUrl } from '@/lib/desktop-releases'

export function WebLanding() {
  return (
    <div className="bg-background text-text-1 flex min-h-svh flex-col">
      <header className="border-border/60 flex items-center justify-between border-b px-6 py-4">
        <div className="flex items-center gap-3">
          <img
            src="/braian-logo.png"
            alt=""
            width={40}
            height={40}
            className="rounded-lg"
            aria-hidden
          />
          <span className="text-lg font-semibold tracking-tight">Braian</span>
        </div>
        <Button asChild size="sm">
          <Link to="/dashboard" search={{ tab: 'overview' }}>
            Continue in browser
          </Link>
        </Button>
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 px-6 py-14">
        <div className="flex flex-col items-center gap-6 text-center">
          <img
            src="/braian-logo.png"
            alt="Braian"
            width={112}
            height={112}
            className="rounded-3xl shadow-sm"
          />
          <div className="space-y-3">
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Your desk, your workspace
            </h1>
            <p className="text-text-2 max-w-lg text-base leading-relaxed">
              Braian Desktop is built for serious work on your machine. This
              site is here when you step away from that desk.
            </p>
          </div>
        </div>

        <div className="border-border/60 bg-muted/25 space-y-5 rounded-xl border p-6 text-left">
          <section className="space-y-2">
            <h2 className="text-base font-semibold">Desktop app (full Braian)</h2>
            <p className="text-text-2 text-sm leading-relaxed">
              Local workspaces, SQLite, filesystem tools, MCP, and the full
              assistant experience run in the Tauri app. That is the product we
              optimize for.
            </p>
          </section>
          <section className="space-y-2">
            <h2 className="text-base font-semibold">Web (carry on)</h2>
            <p className="text-text-2 text-sm leading-relaxed">
              In the browser you can pick up synced threads and use a minimal
              chat path when cloud is configured. There is no workspace on the
              server and no substitute for the desktop feature set.
            </p>
          </section>
        </div>

        <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Button asChild size="lg" className="min-w-[12rem]">
            <Link to="/dashboard" search={{ tab: 'overview' }}>
              Continue in browser
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg" className="min-w-[12rem]">
            <a
              href={desktopReleasesLatestPageUrl()}
              target="_blank"
              rel="noopener noreferrer"
            >
              Download for desktop
            </a>
          </Button>
        </div>
        <p className="text-text-3 text-center text-xs">
          Opens the latest GitHub release (pick the installer for your OS).
        </p>
      </main>
    </div>
  )
}
