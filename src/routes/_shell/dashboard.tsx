import { createFileRoute } from '@tanstack/react-router'
import { LayoutTemplate, Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'

export const Route = createFileRoute('/_shell/dashboard')({
  component: DashboardPage,
})

function DashboardPage() {
  return (
    <div className="flex flex-1 flex-col overflow-auto">
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-5 py-8 md:px-8 md:py-12">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <p className="text-text-3 text-xs font-medium tracking-widest uppercase">
              Overview
            </p>
            <h2 className="text-text-1 text-2xl font-semibold tracking-tight md:text-3xl">
              Dashboard
            </h2>
            <p className="text-text-2 max-w-xl text-sm leading-relaxed md:text-base">
              This canvas is ready for widgets, runs, and files. For now it is
              intentionally empty so layout and navigation can be refined first.
            </p>
          </div>
          <Button type="button" variant="outline" className="shrink-0 gap-2" disabled>
            <Plus className="size-4" />
            Add tile
          </Button>
        </header>
        <div className="border-border bg-card/40 relative flex min-h-[320px] flex-1 flex-col items-center justify-center overflow-hidden rounded-2xl border border-dashed p-8 md:min-h-[420px]">
          <div className="from-accent-500/8 pointer-events-none absolute inset-0 bg-linear-to-b to-transparent" />
          <div className="relative flex max-w-md flex-col items-center gap-4 text-center">
            <div className="bg-accent-500/12 text-accent-600 border-accent-500/20 flex size-14 items-center justify-center rounded-2xl border shadow-sm">
              <LayoutTemplate className="size-7" />
            </div>
            <div className="space-y-2">
              <h3 className="text-text-1 text-lg font-semibold">
                Nothing here yet
              </h3>
              <p className="text-text-2 text-sm leading-relaxed">
                Pin artifacts, metrics, or shortcuts from chat sessions. When the
                data layer lands, this grid will populate automatically.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
