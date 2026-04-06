import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { CalculatorPage } from './pages/CalculatorPage'

/**
 * ROUTING HUB — landing + sub-app registry in ONE file on purpose.
 *
 * - NEW MINI-APP: add `pages/<Thing>Page.tsx`, import it, append ONE object to `APP_ROUTES`.
 * - NEVER move feature UI onto `/`. NEVER replace `MyAppsLandingPage` with a tool/form/dashboard.
 * - `/` only lists links from `APP_ROUTES`; the feature lives on `path` (e.g. `/email-checker`).
 */
export type AppRouteEntry = {
  path: string
  label: string
  element: ReactNode
}

export const APP_ROUTES: AppRouteEntry[] = [
  {
    path: '/calculator',
    label: 'Calculator',
    element: <CalculatorPage />,
  },
]

/** `/` — My apps index only. Do not replace with a feature screen. */
export function MyAppsLandingPage() {
  return (
    <div className="flex min-h-full flex-col gap-8 p-6 md:p-10">
      <header className="border-app-border max-w-2xl border-b pb-6">
        <p className="text-app-accent-600 mb-2 text-xs font-semibold tracking-widest uppercase">
          Workspace app
        </p>
        <h1 className="text-app-text-1 text-2xl font-semibold tracking-tight md:text-3xl">
          My apps
        </h1>
        <p className="text-app-text-3 mt-2 max-w-xl text-sm leading-relaxed">
          Entry point only: each mini-app has its own URL below.           To add one, create a new page under{' '}
          <code className="text-app-text-2 bg-app-bg-1 rounded px-1 py-0.5 text-xs">
            src/pages/
          </code>{' '}
          and append a row to{' '}
          <code className="text-app-text-2 bg-app-bg-1 rounded px-1 py-0.5 text-xs">
            APP_ROUTES
          </code>{' '}
          in this file — do not build the feature on{' '}
          <code className="text-app-text-2">/</code>.
        </p>
      </header>

      <main className="max-w-2xl flex-1">
        <h2 className="text-app-text-2 mb-4 text-sm font-medium">
          Open a sub-app
        </h2>
        {APP_ROUTES.length === 0 ? (
          <p className="text-app-text-3 text-sm">
            No sub-apps yet. Append to <code className="text-app-text-2">APP_ROUTES</code>{' '}
            in <code className="text-app-text-2">app-routes.tsx</code>.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {APP_ROUTES.map((r) => (
              <li key={r.path}>
                <Link
                  to={r.path}
                  className="border-app-border bg-app-bg-1 hover:border-app-accent-600/40 hover:bg-app-bg-2 group flex items-center justify-between gap-4 rounded-xl border px-5 py-4 shadow-sm transition-colors"
                >
                  <div>
                    <span className="text-app-text-1 group-hover:text-app-accent-500 font-medium">
                      {r.label}
                    </span>
                    <p className="text-app-text-3 mt-0.5 font-mono text-xs">
                      {r.path}
                    </p>
                  </div>
                  <span
                    className="text-app-accent-600 group-hover:text-app-accent-500 text-sm font-medium"
                    aria-hidden
                  >
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}
