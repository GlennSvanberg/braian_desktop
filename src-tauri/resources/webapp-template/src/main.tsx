import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import { App } from './App'
import './index.css'

const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
document.documentElement.classList.add(prefersDark ? 'dark' : 'light')

/** React Router basename: no trailing slash (Vite BASE_URL usually has one). */
const routerBasename = (() => {
  const raw = import.meta.env.BASE_URL
  if (raw === '/') return undefined
  return raw.endsWith('/') ? raw.slice(0, -1) : raw
})()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={routerBasename}>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
