import { Route, Routes } from 'react-router-dom'

import { APP_ROUTES, MyAppsLandingPage } from './app-routes'
import { BraianShell } from './layouts/BraianShell'

/**
 * Root shell + router. Keep `path="/"` → `MyAppsLandingPage` as-is.
 * New features: only `app-routes.tsx` + `pages/*`.
 */
export function App() {
  return (
    <BraianShell>
      <Routes>
        <Route path="/" element={<MyAppsLandingPage />} />
        {APP_ROUTES.map((r) => (
          <Route key={r.path} path={r.path} element={r.element} />
        ))}
      </Routes>
    </BraianShell>
  )
}
