import { invoke } from '@tauri-apps/api/core'

import {
  EMPTY_MCP_CONFIG,
  type WorkspaceMcpConfigDocument,
} from '@/lib/mcp-config-types'
import {
  cancelWorkspaceMcpIdleDisconnect,
  workspaceMcpSessionsDisconnect,
} from '@/lib/mcp-runtime-api'
import { isTauri } from '@/lib/tauri-env'

/** Payload matching Rust `WorkspaceMcpConfigDto` (camelCase). */
export type WorkspaceMcpConfigDto = {
  mcpServers: Record<string, unknown>
  braian?: {
    disabledMcpServers?: string[]
    defaultActiveMcpServers?: string[]
  }
}

function dtoToDocument(dto: WorkspaceMcpConfigDto): WorkspaceMcpConfigDocument {
  const servers: WorkspaceMcpConfigDocument['mcpServers'] = {}
  for (const [k, v] of Object.entries(dto.mcpServers ?? {})) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      servers[k] = v as WorkspaceMcpConfigDocument['mcpServers'][string]
    }
  }
  const disabled = dto.braian?.disabledMcpServers?.filter(
    (s) => typeof s === 'string',
  )
  const defaultActive = dto.braian?.defaultActiveMcpServers?.filter(
    (s) => typeof s === 'string',
  )
  return {
    mcpServers: servers,
    braian:
      (disabled && disabled.length > 0) ||
      (defaultActive && defaultActive.length > 0)
        ? {
            ...(disabled && disabled.length > 0
              ? { disabledMcpServers: disabled }
              : {}),
            ...(defaultActive && defaultActive.length > 0
              ? { defaultActiveMcpServers: defaultActive }
              : {}),
          }
        : undefined,
  }
}

function documentToDto(doc: WorkspaceMcpConfigDocument): WorkspaceMcpConfigDto {
  return {
    mcpServers: { ...doc.mcpServers },
    braian:
      (doc.braian?.disabledMcpServers?.length ?? 0) > 0 ||
      (doc.braian?.defaultActiveMcpServers?.length ?? 0) > 0
        ? {
            disabledMcpServers: [...(doc.braian?.disabledMcpServers ?? [])],
            defaultActiveMcpServers: [
              ...(doc.braian?.defaultActiveMcpServers ?? []),
            ],
          }
        : undefined,
  }
}

export async function workspaceMcpConfigGet(
  workspaceId: string,
): Promise<WorkspaceMcpConfigDocument> {
  if (!isTauri()) {
    return { ...EMPTY_MCP_CONFIG }
  }
  const dto = await invoke<WorkspaceMcpConfigDto>('workspace_mcp_config_get', {
    workspaceId,
  })
  return dtoToDocument(dto)
}

export async function workspaceMcpConfigSet(
  workspaceId: string,
  config: WorkspaceMcpConfigDocument,
): Promise<void> {
  if (!isTauri()) {
    throw new Error('Saving connections requires the desktop app.')
  }
  await invoke('workspace_mcp_config_set', {
    workspaceId,
    config: documentToDto(config),
  })
  cancelWorkspaceMcpIdleDisconnect(workspaceId)
  await workspaceMcpSessionsDisconnect(workspaceId)
}

export type McpToolProbeSummary = {
  name: string
  description?: string | null
}

export type McpConnectionProbeResult = {
  ok: boolean
  toolCount: number | null
  errorMessage: string | null
  transport: string
  /** Names (and optional descriptions) from a real MCP `tools/list` handshake. */
  tools?: McpToolProbeSummary[]
}

/** Runs a short MCP handshake (stdio) or HTTP GET (remote). Desktop only. */
export async function workspaceMcpProbeConnection(
  workspaceId: string,
  serverName: string,
): Promise<McpConnectionProbeResult> {
  if (!isTauri()) {
    return {
      ok: false,
      toolCount: null,
      errorMessage: 'Connection checks run only in the desktop app.',
      transport: 'unknown',
    }
  }
  return invoke<McpConnectionProbeResult>('workspace_mcp_probe_connection', {
    workspaceId,
    serverName,
  })
}
