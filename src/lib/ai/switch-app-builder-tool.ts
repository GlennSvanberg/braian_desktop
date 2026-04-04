import { toolDefinition } from '@tanstack/ai'
import { z } from 'zod'

import { isDetachedWorkspaceSessionId } from '@/lib/chat-sessions/detached'

import { DASHBOARD_TOOL_NAMES } from './dashboard-tools'

import type { ChatTurnContext } from './types'

const switchInputSchema = z.object({
  reason: z
    .string()
    .optional()
    .describe('Brief note on why workspace dashboard tools are needed.'),
})

const discoveryNamesJson = JSON.stringify([...DASHBOARD_TOOL_NAMES])

/**
 * Eager tool when App mode is off: enables persisted app harness and tells the model
 * how to unlock lazy dashboard tools (same pattern as switch_to_code_agent).
 */
export function buildSwitchToAppBuilderTool(context: ChatTurnContext | undefined) {
  if (
    !context?.workspaceId ||
    isDetachedWorkspaceSessionId(context.workspaceId) ||
    context.appHarnessEnabled === true
  ) {
    return null
  }

  return toolDefinition({
    name: 'switch_to_app_builder',
    description: `Enable **workspace dashboard / in-app page** tools for this chat (Braian sidebar Dashboard and \`/dashboard/page/...\`). The user does not need to select App mode in the UI — you enable this by calling this tool.

**Required workflow after this tool returns successfully:** immediately call \`__lazy__tool__discovery__\` with argument toolNames exactly: ${discoveryNamesJson}. Then use read_workspace_dashboard, apply_workspace_dashboard, and upsert_workspace_page.

**Do not** satisfy "add to my dashboard", "hello world app in Braian", KPI tiles, or in-app pages by pasting standalone \`index.html\` or raw HTML — Braian renders **JSON manifests** and markdown tiles via those tools.

Call this when the user wants anything on the workspace overview dashboard, a page inside Braian, or widgets/tiles (including simple "hello world" / lorem content as markdown or a page JSON file).`,
    inputSchema: switchInputSchema,
  }).server(async (args) => {
    switchInputSchema.parse(args)
    context.onAppHarnessEnabledChange?.(true)
    return {
      ok: true as const,
      message:
        'Workspace app builder is enabled for this conversation. Next: call __lazy__tool__discovery__ with the toolNames array below.',
      discoveryToolNames: [...DASHBOARD_TOOL_NAMES],
    }
  })
}
