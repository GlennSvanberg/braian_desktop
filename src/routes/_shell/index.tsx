import { createFileRoute, Navigate } from '@tanstack/react-router'

export const Route = createFileRoute('/_shell/')({
  component: ShellIndexRedirect,
})

function ShellIndexRedirect() {
  return (
    <Navigate to="/dashboard" search={{ tab: 'overview' }} replace />
  )
}
