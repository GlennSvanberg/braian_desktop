import { toolDefinition } from '@tanstack/ai'
import { z } from 'zod'

import { WORKSPACE_CODE_TOOL_NAMES } from '@/lib/ai/coding-tools'

import { isNonWorkspaceScopedSessionId } from '@/lib/chat-sessions/detached'

import type { ChatTurnContext } from './types'

const switchInputSchema = z.object({
  reason: z
    .string()
    .optional()
    .describe('Brief internal note on why workspace code tools are needed.'),
})

const discoveryNamesJson = JSON.stringify([...WORKSPACE_CODE_TOOL_NAMES])

/**
 * Eager tool in document-style turns: switches persisted agent mode and tells the model
 * how to unlock lazy workspace tools via TanStack AI’s discovery tool.
 */
export function buildSwitchToCodeAgentTool(context: ChatTurnContext | undefined) {
  if (
    !context?.workspaceId ||
    isNonWorkspaceScopedSessionId(context.workspaceId)
  ) {
    return null
  }

  return toolDefinition({
    name: 'switch_to_code_agent',
    description: `Enable **workspace code capabilities** for this chat (run programs, read/write files under the workspace, CSV/Excel conversion scripts, pip installs, and similar tasks). The user does not need to change any UI setting.

**Required workflow after this tool returns successfully:** immediately call the tool \`__lazy__tool__discovery__\` with argument toolNames exactly: ${discoveryNamesJson}. Then use read_workspace_file, write_workspace_file, list_workspace_dir, and run_workspace_command as needed.

Call this when the task needs workspace files or commands. Do not tell the user to flip a "Code mode" toggle.`,
    inputSchema: switchInputSchema,
  }).server(async (args) => {
    switchInputSchema.parse(args)
    context.onAgentModeChange?.('code')
    return {
      ok: true as const,
      message:
        'Code agent capabilities are enabled for this conversation. Next: call __lazy__tool__discovery__ with the toolNames array below.',
      discoveryToolNames: [...WORKSPACE_CODE_TOOL_NAMES],
    }
  })
}
