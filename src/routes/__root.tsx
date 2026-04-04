import {
  HeadContent,
  Link,
  Scripts,
  createRootRoute,
} from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'

import appCss from '../styles/app.css?url'

const THEME_INIT_SCRIPT = `(function(){try{var stored=window.localStorage.getItem('theme');var mode=(stored==='light'||stored==='dark'||stored==='auto')?stored:'auto';var prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;var resolved=mode==='auto'?(prefersDark?'dark':'light'):mode;var root=document.documentElement;root.classList.remove('light','dark');root.classList.add(resolved);if(mode==='auto'){root.removeAttribute('data-theme')}else{root.setAttribute('data-theme',mode)}root.style.colorScheme=resolved;}catch(e){}})();`

function NotFoundPage() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-5 p-8 text-center">
      <div className="space-y-2">
        <h1 className="text-text-1 text-lg font-semibold">Page not found</h1>
        <p className="text-text-2 max-w-sm text-sm leading-relaxed">
          The link may be broken, or the conversation was removed from the mock
          data.
        </p>
      </div>
      <Button asChild>
        <Link to="/dashboard">Return to dashboard</Link>
      </Button>
    </div>
  )
}

export const Route = createRootRoute({
  notFoundComponent: NotFoundPage,
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'Braian Desktop',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
      {
        rel: 'icon',
        href: '/favicon.ico',
      },
      {
        rel: 'icon',
        type: 'image/png',
        href: '/braian-logo.png',
      },
      {
        rel: 'apple-touch-icon',
        href: '/logo192.png',
      },
      {
        rel: 'manifest',
        href: '/manifest.json',
      },
    ],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false)
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    // Keep splash screen visible for a short time to cover initial rendering
    const fadeTimer = setTimeout(() => setMounted(true), 800)
    const hideTimer = setTimeout(() => setHidden(true), 1100) // 800 + 300ms transition
    return () => {
      clearTimeout(fadeTimer)
      clearTimeout(hideTimer)
    }
  }, [])

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <HeadContent />
      </head>
      <body>
        {!hidden && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 9999,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'var(--app-bg-0, #0f1114)',
              color: 'var(--app-text-1, #f2f2ee)',
              opacity: mounted ? 0 : 1,
              transition: 'opacity 0.3s ease-out',
              pointerEvents: 'none',
            }}
          >
            <div 
              className="animate-pulse"
              style={{ 
                display: 'flex', 
                flexDirection: 'column', 
                alignItems: 'center', 
                gap: '1rem' 
              }}
            >
              <img
                src="/braian-logo.png"
                alt="Braian Logo"
                style={{ width: '120px', height: '120px', borderRadius: '24px' }}
              />
              <div style={{ fontSize: '32px', fontWeight: 600, letterSpacing: '-0.02em' }}>
                BRAIAN
              </div>
            </div>
          </div>
        )}
        {children}
        <Scripts />
      </body>
    </html>
  )
}
