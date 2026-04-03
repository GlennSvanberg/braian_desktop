import { createFileRoute } from '@tanstack/react-router'

import { Button } from '@/components/ui/button'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6">
      <div className="text-center">
        <p className="mb-2 text-sm font-medium tracking-wide text-text-3 uppercase">
          Local-first workspace
        </p>
        <h1 className="text-3xl font-semibold text-text-1 sm:text-4xl">
          Braian Desktop
        </h1>
        <p className="mt-3 max-w-md text-pretty text-text-2">
          TanStack Start, Tauri, SQLite, and shadcn/ui are wired up. Build the
          chat and artifact canvas from here.
        </p>
      </div>
      <Button type="button">Hello world</Button>
    </main>
  )
}
