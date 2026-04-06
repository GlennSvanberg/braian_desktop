import { createFileRoute, Navigate } from '@tanstack/react-router'

export const Route = createFileRoute('/_shell/settings')({
  component: SettingsRedirect,
})

function SettingsRedirect() {
  return <Navigate to="/user" search={{ tab: 'ai' }} replace />
}
