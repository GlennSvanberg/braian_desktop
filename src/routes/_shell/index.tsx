import { createFileRoute, Navigate } from '@tanstack/react-router'

import { WebLanding } from '@/components/app/web-landing'
import { useRuntimeHost } from '@/lib/runtime-host'

export const Route = createFileRoute('/_shell/')({
  component: ShellIndex,
  head: () => ({
    meta: [
      {
        name: 'description',
        content:
          'Braian Desktop is a local-first AI workspace: chat plus a persistent Workspace for documents, data views, and visuals. Optional cloud sync mirrors conversations when you choose it.',
      },
    ],
  }),
})

function ShellIndex() {
  const host = useRuntimeHost()

  if (host === 'pending') {
    return null
  }

  if (host === 'tauri') {
    return (
      <Navigate to="/dashboard" search={{ tab: 'overview' }} replace />
    )
  }

  return <WebLanding />
}
