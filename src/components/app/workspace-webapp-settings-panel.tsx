import { WorkspaceWebappPreviewCore } from '@/components/app/workspace-webapp-preview-core'
import { cn } from '@/lib/utils'

type Props = {
  workspaceId: string
  isTauriRuntime: boolean
  className?: string
}

export function WorkspaceWebappSettingsPanel({
  workspaceId,
  isTauriRuntime,
  className,
}: Props) {
  return (
    <WorkspaceWebappPreviewCore
      workspaceId={workspaceId}
      isTauriRuntime={isTauriRuntime}
      layout="settings"
      variant="full"
      className={cn(className)}
    />
  )
}
