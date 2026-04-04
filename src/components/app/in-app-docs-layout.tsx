import { type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'

import { listInAppDocs } from '@/lib/in-app-docs/registry'
import { cn } from '@/lib/utils'

export function InAppDocsShell({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  const topics = listInAppDocs()

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
      <aside
        className="border-border bg-card/30 shrink-0 border-b lg:w-52 lg:border-r lg:border-b-0 lg:pt-2"
        aria-label="Documentation topics"
      >
        <nav className="flex gap-1 overflow-x-auto p-3 lg:flex-col lg:gap-0.5 lg:overflow-x-visible lg:p-4">
          <Link
            to="/docs"
            className="text-text-3 hover:bg-accent-500/10 hover:text-text-1 shrink-0 rounded-md px-3 py-2 text-sm font-medium transition-colors lg:w-full"
            activeProps={{
              className:
                'bg-accent-500/15 text-text-1 shrink-0 rounded-md px-3 py-2 text-sm font-semibold transition-colors lg:w-full',
            }}
            activeOptions={{ exact: true }}
          >
            Start here
          </Link>
          {topics.map((t) => (
            <Link
              key={t.slug}
              to="/docs/$slug"
              params={{ slug: t.slug }}
              className="text-text-3 hover:bg-accent-500/10 hover:text-text-1 shrink-0 rounded-md px-3 py-2 text-sm transition-colors lg:w-full"
              activeProps={{
                className:
                  'bg-accent-500/15 text-text-1 shrink-0 rounded-md px-3 py-2 text-sm font-semibold transition-colors lg:w-full',
              }}
            >
              {t.title}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto">
        <div className="mx-auto w-full max-w-3xl flex-1 px-5 py-8 md:px-8 md:py-10">
          <header className="mb-8 space-y-2">
            <p className="text-text-3 text-xs font-medium tracking-widest uppercase">
              Documentation
            </p>
            <h1 className="text-text-1 text-2xl font-semibold tracking-tight md:text-3xl">
              {title}
            </h1>
            {description ? (
              <p className="text-text-2 max-w-2xl text-sm leading-relaxed md:text-base">
                {description}
              </p>
            ) : null}
          </header>
          <div className={cn('pb-12')}>{children}</div>
        </div>
      </div>
    </div>
  )
}
