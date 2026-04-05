import { invoke } from '@tauri-apps/api/core'

import {
  EMPTY_MCP_CONFIG,
  type WorkspaceMcpConfigDocument,
} from '@/lib/mcp-config-types'
import { isTauri } from '@/lib/tauri-env'

/** Payload matching Rust `WorkspaceMcpConfigDto` (camelCase). */
export type WorkspaceMcpConfigDto = {
  mcpServers: Record<string, unknown>
  braian?: { disabledMcpServers: string[] }
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
  return {
    mcpServers: servers,
    braian:
      disabled && disabled.length > 0
        ? { disabledMcpServers: disabled }
        : undefined,
  }
}

function documentToDto(doc: WorkspaceMcpConfigDocument): WorkspaceMcpConfigDto {
  return {
    mcpServers: { ...doc.mcpServers },
    braian: doc.braian?.disabledMcpServers?.length
      ? { disabledMcpServers: [...doc.braian.disabledMcpServers] }
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
}
