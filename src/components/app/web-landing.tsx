import type { ComponentType, ReactNode } from 'react'

import { Link } from '@tanstack/react-router'
import {
  Cloud,
  FileText,
  GitBranch,
  ImageIcon,
  LayoutGrid,
  Lock,
  Plug,
  Sparkles,
  Table2,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'

const dashboardSearch = { tab: 'overview' as const }

function NavLink({
  href,
  children,
}: {
  href: string
  children: ReactNode
}) {
  return (
    <a
      href={href}
      className="text-text-2 hover:text-text-1 text-sm font-medium transition-colors"
    >
      {children}
    </a>
  )
}

function SectionTitle({
  id,
  eyebrow,
  title,
  description,
}: {
  id: string
  eyebrow: string
  title: string
  description: string
}) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-accent-600 mb-2 text-xs font-semibold tracking-wide uppercase">
        {eyebrow}
      </p>
      <h2
        id={id}
        className="text-text-1 text-2xl font-semibold tracking-tight sm:text-3xl"
      >
        {title}
      </h2>
      <p className="text-text-2 mt-3 text-base leading-relaxed">{description}</p>
    </div>
  )
}

function PillarCard({
  icon: Icon,
  title,
  body,
}: {
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
  title: string
  body: string
}) {
  return (
    <div className="border-border/60 bg-card/80 flex flex-col gap-3 rounded-2xl border p-6 shadow-sm">
      <div className="bg-attention-soft text-accent-600 flex size-10 items-center justify-center rounded-xl">
        <Icon className="size-5" aria-hidden />
      </div>
      <h3 className="text-text-1 text-base font-semibold">{title}</h3>
      <p className="text-text-2 text-sm leading-relaxed">{body}</p>
    </div>
  )
}

function CapabilityCard({
  icon: Icon,
  title,
  body,
  badges,
}: {
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
  title: string
  body: string
  badges: ReactNode
}) {
  return (
    <div className="border-border/60 bg-card flex flex-col gap-4 rounded-2xl border p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="bg-attention-soft text-accent-600 flex size-10 shrink-0 items-center justify-center rounded-xl">
          <Icon className="size-5" aria-hidden />
        </div>
        <div className="flex flex-wrap justify-end gap-1.5">{badges}</div>
      </div>
      <div className="space-y-2">
        <h3 className="text-text-1 text-base font-semibold">{title}</h3>
        <p className="text-text-2 text-sm leading-relaxed">{body}</p>
      </div>
    </div>
  )
}

function CompareColumn({
  title,
  subtitle,
  items,
  variant,
}: {
  title: string
  subtitle: string
  items: string[]
  variant: 'desktop' | 'web'
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-4 rounded-2xl border p-6 sm:p-8',
        variant === 'desktop'
          ? 'border-accent-500/25 bg-attention-soft/40'
          : 'border-border/60 bg-muted/20',
      )}
    >
      <div>
        <h3 className="text-text-1 text-lg font-semibold">{title}</h3>
        <p className="text-text-2 mt-1 text-sm leading-relaxed">{subtitle}</p>
      </div>
      <Separator />
      <ul className="text-text-2 space-y-3 text-sm leading-relaxed">
        {items.map((line) => (
          <li key={line} className="flex gap-2">
            <span className="text-accent-600 mt-0.5 font-bold" aria-hidden>
              ·
            </span>
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function WebLanding() {
  return (
    <div className="bg-background text-text-1 flex min-h-svh flex-col">
      <header className="border-border/60 bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky top-0 z-50 border-b backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <img
              src="/braian-logo.png"
              alt=""
              width={36}
              height={36}
              className="rounded-lg"
              aria-hidden
            />
            <span className="text-lg font-semibold tracking-tight">Braian</span>
            <nav
              className="text-text-3 ml-2 hidden items-center gap-6 md:flex"
              aria-label="Page sections"
            >
              <NavLink href="#product">Product</NavLink>
              <NavLink href="#why-braian">Why Braian</NavLink>
              <NavLink href="#capabilities">Capabilities</NavLink>
              <NavLink href="#compare">Desktop &amp; web</NavLink>
            </nav>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="hidden sm:inline-flex"
              disabled
              title="Installers are not published yet"
            >
              Download
            </Button>
            <Button asChild size="sm">
              <Link to="/dashboard" search={dashboardSearch}>
                Continue in browser
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main>
        <section
          id="product"
          className="border-border/40 relative scroll-mt-20 border-b sm:scroll-mt-24"
          aria-labelledby="hero-heading"
        >
          <div className="from-bg-1/30 pointer-events-none absolute inset-0 bg-gradient-to-b to-transparent" />
          <div className="relative mx-auto flex max-w-6xl flex-col gap-12 px-4 py-16 sm:px-6 sm:py-24 lg:flex-row lg:items-center lg:gap-16 lg:py-28">
            <div className="flex flex-1 flex-col gap-8">
              <div className="space-y-6">
                <Badge variant="secondary" className="w-fit">
                  Local-first AI workspace
                </Badge>
                <div className="space-y-4">
                  <h1
                    id="hero-heading"
                    className="text-3xl font-semibold tracking-tight sm:text-4xl lg:text-5xl lg:leading-[1.1]"
                  >
                    Turn conversations into durable work—on your machine.
                  </h1>
                  <p className="text-text-2 max-w-xl text-lg leading-relaxed">
                    Braian Desktop pairs chat with a persistent{' '}
                    <strong className="text-text-1 font-semibold">
                      Workspace
                    </strong>{' '}
                    for documents, structured data, and visuals. Your files and
                    context stay local; optional cloud only mirrors conversations
                    when you enable it.
                  </p>
                </div>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <Button asChild size="lg" className="min-w-[11rem]">
                  <Link to="/dashboard" search={dashboardSearch}>
                    Continue in browser
                  </Link>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  className="min-w-[11rem]"
                  disabled
                  title="Installers are not published yet"
                >
                  Download for desktop
                </Button>
              </div>
              <p className="text-text-3 text-sm">
                Desktop installers are coming soon. Until then, use internal
                builds or run from source for the full Braian experience.
              </p>
            </div>
            <div className="border-border/60 bg-card/60 flex flex-1 flex-col gap-3 rounded-2xl border p-4 shadow-sm sm:p-5">
              <p className="text-text-3 px-1 text-xs font-medium tracking-wide uppercase">
                Workspace preview
              </p>
              <div className="grid min-h-[220px] grid-cols-2 gap-2 sm:min-h-[260px]">
                <div className="border-border/60 bg-background/80 flex flex-col rounded-xl border p-3">
                  <FileText
                    className="text-accent-600 mb-2 size-4"
                    aria-hidden
                  />
                  <span className="text-text-1 text-xs font-semibold">
                    Document
                  </span>
                  <span className="text-text-3 mt-1 text-[11px] leading-snug">
                    Specs, briefs, memos beside the thread
                  </span>
                </div>
                <div className="border-border/60 bg-background/80 flex flex-col rounded-xl border p-3">
                  <Table2
                    className="text-accent-600 mb-2 size-4"
                    aria-hidden
                  />
                  <span className="text-text-1 text-xs font-semibold">Data</span>
                  <span className="text-text-3 mt-1 text-[11px] leading-snug">
                    Tabular views from CSV and spreadsheets
                  </span>
                </div>
                <div className="border-border/60 bg-background/80 col-span-2 flex flex-col rounded-xl border p-3">
                  <ImageIcon
                    className="text-accent-600 mb-2 size-4"
                    aria-hidden
                  />
                  <span className="text-text-1 text-xs font-semibold">
                    Visual
                  </span>
                  <span className="text-text-3 mt-1 text-[11px] leading-snug">
                    Image outputs and previews in one place
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section
          id="why-braian"
          className="border-border/40 scroll-mt-20 border-b py-16 sm:scroll-mt-24 sm:py-20"
          aria-labelledby="why-heading"
        >
          <div className="mx-auto max-w-6xl space-y-12 px-4 sm:px-6">
            <SectionTitle
              id="why-heading"
              eyebrow="Why Braian"
              title="Built for serious work—not another disposable chat tab"
              description="Braian is not a generic web assistant and not a coding-only IDE. It is a Tauri desktop workspace where the model can work with your folders, tools, and outputs you keep."
            />
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              <PillarCard
                icon={Lock}
                title="Local-first by default"
                body="Your workspace and files stay on your device. SQLite and app data bootstrap locally. Cloud sync is opt-in and treats the cloud as a replica—not the source of truth."
              />
              <PillarCard
                icon={LayoutGrid}
                title="Workspace-centric outputs"
                body="Chat drives a real surface beside it: long-form documents, data tables, and visual artifacts so results are inspectable, editable, and ready to share."
              />
              <PillarCard
                icon={Plug}
                title="Agentic execution"
                body="Extend Braian with MCP and workspace-scoped skills so the assistant uses the same connections and guardrails you configure—not a one-size web sandbox."
              />
              <PillarCard
                icon={Cloud}
                title="Optional continuity"
                body="When Convex is configured, sync conversations to pick up threads in the browser. Local files remain canonical; the web path stays intentionally minimal."
              />
            </div>
          </div>
        </section>

        <section
          id="capabilities"
          className="border-border/40 scroll-mt-20 border-b py-16 sm:scroll-mt-24 sm:py-20"
          aria-labelledby="capabilities-heading"
        >
          <div className="mx-auto max-w-6xl space-y-12 px-4 sm:px-6">
            <SectionTitle
              id="capabilities-heading"
              eyebrow="What you can do"
              title="From local files to living artifacts"
              description="The desktop app is where Braian is fully realized. Use the list below to set expectations for yourself and your team."
            />
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              <CapabilityCard
                icon={Sparkles}
                title="Multi-provider assistant"
                body="Bring your own keys and choose models across supported providers via TanStack AI—without sending your workspace to a single vendor UI."
                badges={
                  <>
                    <Badge variant="secondary">Desktop</Badge>
                    <Badge variant="outline">BYOK</Badge>
                  </>
                }
              />
              <CapabilityCard
                icon={Plug}
                title="MCP and skills"
                body="Connect tools through MCP and reuse instruction bundles under your workspace so repeated workflows stay consistent and auditable."
                badges={<Badge variant="secondary">Desktop</Badge>}
              />
              <CapabilityCard
                icon={GitBranch}
                title="Workspace Git checkpoints"
                body="Optional automatic snapshots of your workspace tree help you roll forward and back when the assistant touches many files—implemented with libgit2, not ad hoc copies."
                badges={<Badge variant="secondary">Desktop</Badge>}
              />
              <CapabilityCard
                icon={FileText}
                title="Documents beside chat"
                body="Keep specs, memos, and narrative output in a document canvas the model can update while preserving structure you care about."
                badges={<Badge variant="secondary">Desktop</Badge>}
              />
              <CapabilityCard
                icon={Table2}
                title="Data-oriented canvases"
                body="Ground tabular work in real files—think CSV and spreadsheet-style rows—so analysis and transformations stay tied to sources on disk."
                badges={<Badge variant="secondary">Desktop</Badge>}
              />
              <CapabilityCard
                icon={Cloud}
                title="Synced threads in the browser"
                body="Sign in and continue selected conversations from the web when cloud is enabled. Tools, MCP, skills, and filesystem access remain desktop-only by design."
                badges={
                  <>
                    <Badge variant="outline">Cloud optional</Badge>
                    <Badge variant="secondary">Browser</Badge>
                  </>
                }
              />
            </div>
          </div>
        </section>

        <section
          id="compare"
          className="scroll-mt-20 py-16 sm:scroll-mt-24 sm:py-20"
          aria-labelledby="compare-heading"
        >
          <div className="mx-auto max-w-6xl space-y-12 px-4 sm:px-6">
            <SectionTitle
              id="compare-heading"
              eyebrow="Desktop &amp; web"
              title="Same brand, different surfaces"
              description="We keep the web experience honest: it is for continuity when you have configured sync—not a substitute for the Tauri runtime."
            />
            <div className="grid gap-6 lg:grid-cols-2">
              <CompareColumn
                variant="desktop"
                title="Braian Desktop (full product)"
                subtitle="Tauri shell with filesystem access, SQLite bootstrap, tools, MCP, skills, and the complete Workspace experience."
                items={[
                  'Open and work inside local workspaces with scoped file access.',
                  'Run MCP tools and workspace skills with the same controls you expect from a desktop app.',
                  'Produce and refine documents, tabular data views, and visual artifacts next to chat.',
                  'Optional Git-backed checkpoints for workspace history when you enable them.',
                  'Optional Convex sync pushes completed messages as a replica—local saves stay authoritative.',
                ]}
              />
              <CompareColumn
                variant="web"
                title="Browser (carry on)"
                subtitle="When cloud is configured: view and continue synced threads with a minimal chat path and BYOK through the secure proxy."
                items={[
                  'Pick up synced conversations from another device or when you are away from your desk.',
                  'No workspace filesystem on the server; no replacement for desktop tools or MCP.',
                  'Streaming chat without the full agentic tool surface documented for desktop.',
                  'Ideal for reading, light replies, and continuity—not heavy file manipulation.',
                ]}
              />
            </div>
          </div>
        </section>

        <section
          className="border-border/60 bg-bg-1/40 border-t py-14 sm:py-16"
          aria-labelledby="cta-heading"
        >
          <div className="mx-auto flex max-w-3xl flex-col items-center gap-6 px-4 text-center sm:px-6">
            <h2
              id="cta-heading"
              className="text-2xl font-semibold tracking-tight sm:text-3xl"
            >
              Ready to open Braian?
            </h2>
            <p className="text-text-2 max-w-lg text-base leading-relaxed">
              Start in the browser to explore the shell and settings, then use
              the desktop build when you need your full workspace and tools.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg">
                <Link to="/dashboard" search={dashboardSearch}>
                  Go to dashboard
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link to="/docs">Documentation</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-border/60 text-text-3 mt-auto border-t py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 text-center text-sm sm:flex-row sm:px-6 sm:text-left">
          <div className="flex items-center gap-2">
            <img
              src="/braian-logo.png"
              alt=""
              width={28}
              height={28}
              className="rounded-md opacity-90"
              aria-hidden
            />
            <span>Braian Desktop</span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            <Link
              to="/dashboard"
              search={dashboardSearch}
              className="hover:text-text-2 transition-colors"
            >
              Dashboard
            </Link>
            <Link to="/docs" className="hover:text-text-2 transition-colors">
              Docs
            </Link>
            <a
              href="#product"
              className="hover:text-text-2 md:hidden transition-colors"
            >
              Back to top
            </a>
          </div>
        </div>
      </footer>
    </div>
  )
}
