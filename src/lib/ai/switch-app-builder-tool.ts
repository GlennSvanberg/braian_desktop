import { toolDefinition } from '@tanstack/ai'
import { z } from 'zod'

import { WORKSPACE_ARROW_APP_TOOL_NAMES } from '@/lib/ai/arrow-app-tools'
import { WORKSPACE_CODE_TOOL_NAMES } from '@/lib/ai/coding-tools'

import { isNonWorkspaceScopedSessionId } from '@/lib/chat-sessions/detached'

import type { ChatTurnContext } from './types'

const switchInputSchema = z.object({
  reason: z
    .string()
    .optional()
    .describe('Brief note on why workspace Arrow app tools are needed.'),
})

const APP_BUILDER_DISCOVERY_NAMES = [
  ...WORKSPACE_CODE_TOOL_NAMES,
  ...WORKSPACE_ARROW_APP_TOOL_NAMES,
] as const

const discoveryNamesJson = JSON.stringify([...APP_BUILDER_DISCOVERY_NAMES])

/**
 * Eager tool when App mode is off: enables persisted app harness and tells the model
 * how to unlock lazy workspace code + Arrow app tools (same pattern as switch_to_code_agent).
 */
export function buildSwitchToAppBuilderTool(context: ChatTurnContext | undefined) {
  if (
    !context?.workspaceId ||
    isNonWorkspaceScopedSessionId(context.workspaceId) ||
    context.agentMode === 'app'
  ) {
    return null
  }

  return toolDefinition({
    name: 'switch_to_app_builder',
    description: `Switch this chat to **App agent mode**: workspace **Arrow JS** sandbox apps under \`.braian/arrow-apps/\` (listed on **Dashboard → Apps**, preview in the chat artifact). The user does not need to select App mode in the UI manually.

**Required workflow after this tool returns successfully:** immediately call \`__lazy__tool__discovery__\` with argument toolNames exactly: ${discoveryNamesJson}. Then use file/shell tools for \`.braian/arrow-apps/**\`, \`write_arrow_app\` to create or update apps, \`set_active_arrow_app\` so the UI opens the right app, and \`list_arrow_apps\` / \`read_arrow_app\` / \`delete_arrow_app\` as needed.

**Arrow only:** Implement UI with \`reactive\`, \`html\` template literals, and \`output(payload)\` per the **app-builder** skill — **no** Vite, React, \`npm run dev\`, or \`.braian/webapp\`.

Call this when the user wants an in-workspace interactive mini-app or dashboard-style UI in the Arrow sandbox.`,
    inputSchema: switchInputSchema,
  }).server(async (args) => {
    switchInputSchema.parse(args)
    context.onAgentModeChange?.('app')
    return {
      ok: true as const,
      message:
        'App agent mode is enabled for Arrow sandbox apps. Next: call __lazy__tool__discovery__ with the toolNames array below.',
      discoveryToolNames: [...APP_BUILDER_DISCOVERY_NAMES],
    }
  })
}
