import type { ReactNode } from 'react'

import { CalculatorPage } from './pages/CalculatorPage'

/** Single source of truth: add a sub-app here (route + nav label + page component). */
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
