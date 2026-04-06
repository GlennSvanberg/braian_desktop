import { Link } from 'react-router-dom'

import { APP_ROUTES } from '../app-routes'

export function HomePage() {
  return (
    <div className="flex min-h-full flex-col gap-6 p-6">
      <header className="border-app-border border-b pb-4">
        <h1 className="text-app-text-1 text-xl font-semibold tracking-tight">
          My apps
        </h1>
        <p className="text-app-text-3 mt-1 text-sm">
          One workspace webapp with multiple pages. Add routes in{' '}
          <code className="text-app-text-2">src/app-routes.ts</code> and page
          components under <code className="text-app-text-2">src/pages/</code>.
        </p>
      </header>
      <main className="border-app-border bg-app-bg-1 max-w-md space-y-4 rounded-xl border p-5 shadow-sm">
        <p className="text-app-text-2 text-sm">
          Open a sub-app:
        </p>
        {APP_ROUTES.length === 0 ? (
          <p className="text-app-text-3 text-sm">No sub-apps yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {APP_ROUTES.map((r) => (
              <li key={r.path}>
                <Link
                  to={r.path}
                  className="text-app-accent-600 hover:text-app-accent-500 text-sm font-medium underline-offset-2 hover:underline"
                >
                  {r.label}
                </Link>
                <span className="text-app-text-3 ml-2 font-mono text-xs">
                  {r.path}
                </span>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}
