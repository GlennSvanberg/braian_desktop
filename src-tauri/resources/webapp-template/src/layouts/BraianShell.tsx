import type { ReactNode } from 'react'

/**
 * Global chrome: Braian-aligned palette (see index.css). Keeps every route on-theme
 * even when a page component is minimal. Wrap the whole router in App.tsx — do not remove.
 */
export function BraianShell({ children }: { children: ReactNode }) {
  return (
    <div className="bg-app-bg-0 text-app-text-2 flex min-h-full flex-col antialiased">
      {children}
    </div>
  )
}
