import { invoke } from '@tauri-apps/api/core'

import { isTauri } from '@/lib/tauri-env'

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
): Promise<McpListToolsResultDto> {
  if (!isTauri()) {
    return { servers: [] }
  }
  return invoke<McpListToolsResultDto>('workspace_mcp_list_tools', {
    workspaceId,
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
