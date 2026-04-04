import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/_shell/dashboard')({
  component: DashboardLayout,
})

function DashboardLayout() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <Outlet />
    </div>
  )
}
