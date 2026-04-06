import { invoke } from '@tauri-apps/api/core'

import { isTauri } from '@/lib/tauri-env'

/** After chat goes idle, drop MCP stdio/remote sessions so helper processes do not linger forever. */
const MCP_IDLE_DISCONNECT_MS = 90_000

const mcpIdleDisconnectTimers = new Map<
  string,
  ReturnType<typeof setTimeout>
>()

/**
 * Clears a pending idle disconnect for this workspace (call when a new chat turn starts).
 */
export function cancelWorkspaceMcpIdleDisconnect(workspaceId: string): void {
  const t = mcpIdleDisconnectTimers.get(workspaceId)
  if (t !== undefined) {
    clearTimeout(t)
    mcpIdleDisconnectTimers.delete(workspaceId)
  }
}

/**
 * After {@link MCP_IDLE_DISCONNECT_MS} without a new turn, disconnect MCP sessions for this workspace.
 */
export function scheduleWorkspaceMcpIdleDisconnect(workspaceId: string): void {
  if (!isTauri()) return
  cancelWorkspaceMcpIdleDisconnect(workspaceId)
  const t = setTimeout(() => {
    mcpIdleDisconnectTimers.delete(workspaceId)
    void workspaceMcpSessionsDisconnect(workspaceId).catch((e) => {
      console.error('[braian] MCP idle session cleanup', e)
    })
  }, MCP_IDLE_DISCONNECT_MS)
  mcpIdleDisconnectTimers.set(workspaceId, t)
}

export type McpListToolsServerDto = {
  name: string
  description?: string | null
  error?: string | null
  tools: unknown[]
}

export type McpListToolsResultDto = {
  servers: McpListToolsServerDto[]
}

export async function workspaceMcpListTools(
  workspaceId: string,
  serverNames?: string[],
): Promise<McpListToolsResultDto> {
  if (!isTauri()) {
    return { servers: [] }
  }
  return invoke<McpListToolsResultDto>('workspace_mcp_list_tools', {
    workspaceId,
    serverNames: serverNames ?? null,
  })
}

export async function workspaceMcpCallTool(input: {
  workspaceId: string
  serverName: string
  toolName: string
  arguments: Record<string, unknown>
}): Promise<string> {
  if (!isTauri()) {
    throw new Error('MCP tools require the desktop app.')
  }
  return invoke<string>('workspace_mcp_call_tool', {
    workspaceId: input.workspaceId,
    serverName: input.serverName,
    toolName: input.toolName,
    arguments: input.arguments,
  })
}

export async function workspaceMcpSessionsDisconnect(
  workspaceId: string,
): Promise<void> {
  if (!isTauri()) return
  await invoke('workspace_mcp_sessions_disconnect', { workspaceId })
}
