import { invoke } from '@tauri-apps/api/core'

import { isTauri } from '@/lib/tauri-env'

/** After chat goes idle, drop MCP stdio/remote sessions so helper processes do not linger forever. */
const MCP_IDLE_DISCONNECT_MS_DEFAULT = 90_000
const MCP_IDLE_DISCONNECT_MS_MIN = 5_000
const MCP_IDLE_DISCONNECT_MS_MAX = 3_600_000

/** Bounds for list-tools request timeout used when building MCP tool catalogs. */
const MCP_LIST_TIMEOUT_MS_DEFAULT = 30_000
const MCP_LIST_TIMEOUT_MS_MIN = 1_000
const MCP_LIST_TIMEOUT_MS_MAX = 300_000

const mcpIdleDisconnectTimers = new Map<
  string,
  ReturnType<typeof setTimeout>
>()
const mcpIdleDisconnectScheduleSeq = new Map<string, number>()
const mcpRuntimeSettingsCache = new Map<
  string,
  {
    fetchedAtMs: number
    listTimeoutMs: number
    idleDisconnectMs: number
  }
>()
const MCP_RUNTIME_SETTINGS_CACHE_MS = 15_000

type WorkspaceMcpRuntimeConfigDto = {
  braian?: {
    mcpListTimeoutMs?: number
    mcpIdleDisconnectMs?: number
  }
}

function clampMs(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, Math.trunc(value)))
}

async function workspaceMcpRuntimeSettings(workspaceId: string): Promise<{
  listTimeoutMs: number
  idleDisconnectMs: number
}> {
  if (!isTauri()) {
    return {
      listTimeoutMs: MCP_LIST_TIMEOUT_MS_DEFAULT,
      idleDisconnectMs: MCP_IDLE_DISCONNECT_MS_DEFAULT,
    }
  }

  const now = Date.now()
  const cached = mcpRuntimeSettingsCache.get(workspaceId)
  if (cached && now - cached.fetchedAtMs <= MCP_RUNTIME_SETTINGS_CACHE_MS) {
    return {
      listTimeoutMs: cached.listTimeoutMs,
      idleDisconnectMs: cached.idleDisconnectMs,
    }
  }

  try {
    const dto = await invoke<WorkspaceMcpRuntimeConfigDto>(
      'workspace_mcp_config_get',
      {
        workspaceId,
      },
    )
    const listTimeoutMs = clampMs(
      dto.braian?.mcpListTimeoutMs ?? MCP_LIST_TIMEOUT_MS_DEFAULT,
      MCP_LIST_TIMEOUT_MS_MIN,
      MCP_LIST_TIMEOUT_MS_MAX,
    )
    const idleDisconnectMs = clampMs(
      dto.braian?.mcpIdleDisconnectMs ?? MCP_IDLE_DISCONNECT_MS_DEFAULT,
      MCP_IDLE_DISCONNECT_MS_MIN,
      MCP_IDLE_DISCONNECT_MS_MAX,
    )
    mcpRuntimeSettingsCache.set(workspaceId, {
      fetchedAtMs: now,
      listTimeoutMs,
      idleDisconnectMs,
    })
    return { listTimeoutMs, idleDisconnectMs }
  } catch {
    return {
      listTimeoutMs: MCP_LIST_TIMEOUT_MS_DEFAULT,
      idleDisconnectMs: MCP_IDLE_DISCONNECT_MS_DEFAULT,
    }
  }
}

export function invalidateWorkspaceMcpRuntimeSettings(workspaceId: string): void {
  mcpRuntimeSettingsCache.delete(workspaceId)
}

export async function workspaceMcpListTimeoutMs(
  workspaceId: string,
): Promise<number> {
  const settings = await workspaceMcpRuntimeSettings(workspaceId)
  return settings.listTimeoutMs
}

/**
 * Clears a pending idle disconnect for this workspace (call when a new chat turn starts).
 */
export function cancelWorkspaceMcpIdleDisconnect(workspaceId: string): void {
  const nextSeq = (mcpIdleDisconnectScheduleSeq.get(workspaceId) ?? 0) + 1
  mcpIdleDisconnectScheduleSeq.set(workspaceId, nextSeq)
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
  const nextSeq = (mcpIdleDisconnectScheduleSeq.get(workspaceId) ?? 0) + 1
  mcpIdleDisconnectScheduleSeq.set(workspaceId, nextSeq)
  void workspaceMcpRuntimeSettings(workspaceId).then(({ idleDisconnectMs }) => {
    if (mcpIdleDisconnectScheduleSeq.get(workspaceId) !== nextSeq) return
    const t = setTimeout(() => {
      mcpIdleDisconnectTimers.delete(workspaceId)
      void workspaceMcpSessionsDisconnect(workspaceId).catch((e) => {
        console.error('[braian] MCP idle session cleanup', e)
      })
    }, idleDisconnectMs)
    mcpIdleDisconnectTimers.set(workspaceId, t)
  })
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
