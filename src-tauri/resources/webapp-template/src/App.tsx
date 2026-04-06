import { Route, Routes } from 'react-router-dom'

import { APP_ROUTES } from './app-routes'
import { HomePage } from './pages/HomePage'

export function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      {APP_ROUTES.map((r) => (
        <Route key={r.path} path={r.path} element={r.element} />
      ))}
    </Routes>
  )
}
