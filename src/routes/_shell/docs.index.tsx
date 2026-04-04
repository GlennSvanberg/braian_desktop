import { createFileRoute, Link } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'

import { InAppDocsShell } from '@/components/app/in-app-docs-layout'
import { listInAppDocs } from '@/lib/in-app-docs/registry'

export const Route = createFileRoute('/_shell/docs/')({
  component: DocsIndexPage,
})

function DocsIndexPage() {
  const topics = listInAppDocs()

  return (
    <InAppDocsShell
      title="How Braian works"
      description="Concepts and behavior of this app—workspaces, tools, memory, and what you can expect from the assistant."
    >
      <p className="text-text-2 mb-8 text-sm leading-relaxed md:text-base">
        Pick a topic below or use the sidebar. These pages are shipped from the
        project&apos;s <code className="text-text-1 bg-muted rounded px-1.5 py-0.5 text-xs">docs/app</code> folder as Markdown.
      </p>
      <ul className="flex flex-col gap-3">
        {topics.map((t) => (
          <li key={t.slug}>
            <Link
              to="/docs/$slug"
              params={{ slug: t.slug }}
              className="border-border bg-card/50 hover:border-accent-500/35 hover:bg-card group flex items-start gap-3 rounded-xl border p-4 transition-colors md:p-5"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <span className="text-text-1 group-hover:text-accent-600 flex items-center gap-1 text-base font-semibold">
                  {t.title}
                  <ChevronRight
                    className="text-text-3 group-hover:text-accent-600 size-4 shrink-0 transition-transform group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </span>
                <p className="text-text-2 text-sm leading-relaxed">
                  {t.description}
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </InAppDocsShell>
  )
}
