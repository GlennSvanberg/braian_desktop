import { Link } from '@tanstack/react-router'
import { ExternalLink } from 'lucide-react'

import { DashboardMarkdown } from '@/components/app/dashboard-markdown'
import { Button } from '@/components/ui/button'
import type {
  DashboardManifest,
  ExternalLinkTile,
  KpiTile,
  LinkRegionTile,
  MainTile,
  MarkdownTile,
  PageLinkTile,
  WorkspacePage,
} from '@/lib/workspace-dashboard'
import { isTauri } from '@/lib/tauri-env'
import { cn } from '@/lib/utils'
import { openUrl } from '@tauri-apps/plugin-opener'

/** When set (e.g. chat App preview), page links call this instead of router navigation. */
export type DashboardPageNavigateHandler = (pageId: string) => void

function KpiTileCard({ tile }: { tile: KpiTile }) {
  return (
    <div className="border-border bg-card/80 flex flex-col gap-2 rounded-xl border p-4 shadow-sm">
      <p className="text-text-3 text-xs font-medium tracking-wide uppercase">
        {tile.label}
      </p>
      <p className="text-text-1 text-2xl font-semibold tabular-nums">
        {tile.value}
      </p>
      {tile.hint ? (
        <p className="text-text-3 text-xs leading-relaxed">{tile.hint}</p>
      ) : null}
    </div>
  )
}

function MarkdownTileCard({ tile }: { tile: MarkdownTile }) {
  return (
    <div className="border-border bg-card rounded-xl border p-5 text-sm leading-relaxed shadow-sm">
      <div className="text-text-2">
        <DashboardMarkdown
          markdown={tile.body}
          className="dashboard-tile-markdown"
        />
      </div>
    </div>
  )
}

async function openExternal(href: string) {
  if (isTauri()) {
    try {
      await openUrl(href)
    } catch {
      window.open(href, '_blank', 'noopener,noreferrer')
    }
  } else {
    window.open(href, '_blank', 'noopener,noreferrer')
  }
}

function PageLinkButton({
  tile,
  onPageNavigate,
}: {
  tile: PageLinkTile
  onPageNavigate?: DashboardPageNavigateHandler
}) {
  const inner = (
    <>
      <span className="text-text-1 font-medium">{tile.label}</span>
      {tile.description ? (
        <span className="text-text-3 text-xs font-normal">
          {tile.description}
        </span>
      ) : null}
    </>
  )
  if (onPageNavigate) {
    return (
      <Button
        type="button"
        variant="outline"
        className="border-border text-text-2 h-auto min-h-11 w-full justify-start py-2 whitespace-normal"
        onClick={() => onPageNavigate(tile.pageId)}
      >
        <span className="flex w-full flex-col items-start gap-1 text-left">
          {inner}
        </span>
      </Button>
    )
  }
  return (
    <Button
      variant="outline"
      className="border-border text-text-2 h-auto min-h-11 w-full justify-start py-2 whitespace-normal"
      asChild
    >
      <Link
        to="/dashboard/page/$pageId"
        params={{ pageId: tile.pageId }}
        className="flex w-full flex-col items-start gap-1"
      >
        {inner}
      </Link>
    </Button>
  )
}

function ExternalLinkButton({ tile }: { tile: ExternalLinkTile }) {
  return (
    <Button
      type="button"
      variant="outline"
      className="border-border text-text-2 h-auto min-h-11 w-full justify-start gap-2 py-2 whitespace-normal"
      onClick={() => void openExternal(tile.href)}
    >
      <ExternalLink className="text-text-3 size-4 shrink-0" aria-hidden />
      <span className="text-text-1 block w-full text-left font-medium">
        {tile.label}
      </span>
    </Button>
  )
}

function LinkTileItem({
  tile,
  onPageNavigate,
}: {
  tile: LinkRegionTile
  onPageNavigate?: DashboardPageNavigateHandler
}) {
  if (tile.kind === 'page_link') {
    return <PageLinkButton tile={tile} onPageNavigate={onPageNavigate} />
  }
  return <ExternalLinkButton tile={tile} />
}

function MainTileItem({
  tile,
  onPageNavigate,
}: {
  tile: MainTile
  onPageNavigate?: DashboardPageNavigateHandler
}) {
  switch (tile.kind) {
    case 'kpi':
      return <KpiTileCard tile={tile} />
    case 'markdown':
      return <MarkdownTileCard tile={tile} />
    case 'page_link':
      return (
        <div className="border-border bg-card rounded-xl border p-5 shadow-sm">
          <PageLinkButton tile={tile} onPageNavigate={onPageNavigate} />
        </div>
      )
    default:
      return null
  }
}

export type WorkspaceDashboardViewProps = {
  manifest: DashboardManifest
  className?: string
  onPageNavigate?: DashboardPageNavigateHandler
}

export function WorkspaceDashboardView({
  manifest,
  className,
  onPageNavigate,
}: WorkspaceDashboardViewProps) {
  const { insights, links, main } = manifest.regions

  return (
    <div className={cn('flex flex-col gap-10', className)}>
      {manifest.title ? (
        <h2 className="text-text-1 text-xl font-semibold tracking-tight md:text-2xl">
          {manifest.title}
        </h2>
      ) : null}

      {insights.length > 0 ? (
        <section className="space-y-3">
          <h3 className="text-text-3 text-xs font-medium tracking-widest uppercase">
            Insights
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {insights.map((t) => (
              <KpiTileCard key={t.id} tile={t} />
            ))}
          </div>
        </section>
      ) : null}

      {links.length > 0 ? (
        <section className="space-y-3">
          <h3 className="text-text-3 text-xs font-medium tracking-widest uppercase">
            Shortcuts
          </h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {links.map((t) => (
              <LinkTileItem
                key={t.id}
                tile={t}
                onPageNavigate={onPageNavigate}
              />
            ))}
          </div>
        </section>
      ) : null}

      {main.length > 0 ? (
        <section className="space-y-3">
          <h3 className="text-text-3 text-xs font-medium tracking-widest uppercase">
            Main
          </h3>
          <div className="flex flex-col gap-4">
            {main.map((t) => (
              <MainTileItem
                key={t.id}
                tile={t}
                onPageNavigate={onPageNavigate}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}

export function WorkspacePageView({
  page,
  onPageNavigate,
}: {
  page: WorkspacePage
  onPageNavigate?: DashboardPageNavigateHandler
}) {
  return (
    <div className="flex flex-col gap-8">
      <header className="space-y-2">
        <h1 className="text-text-1 text-2xl font-semibold tracking-tight md:text-3xl">
          {page.title}
        </h1>
        {page.description ? (
          <p className="text-text-2 max-w-2xl text-sm leading-relaxed md:text-base">
            {page.description}
          </p>
        ) : null}
      </header>
      <div className="flex flex-col gap-4">
        {page.tiles.map((t) => (
          <MainTileItem
            key={t.id}
            tile={t}
            onPageNavigate={onPageNavigate}
          />
        ))}
      </div>
    </div>
  )
}
