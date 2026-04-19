import { createFileRoute, Navigate } from '@tanstack/react-router'

import { WebLanding } from '@/components/app/web-landing'
import { useRuntimeHost } from '@/lib/runtime-host'

export const Route = createFileRoute('/_shell/')({
  component: ShellIndex,
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
