import { toolDefinition } from '@tanstack/ai'
import { z } from 'zod'

import { WORKSPACE_CODE_TOOL_NAMES } from '@/lib/ai/coding-tools'
import { WORKSPACE_WEBAPP_TOOL_NAMES } from '@/lib/ai/webapp-tools'

import { isNonWorkspaceScopedSessionId } from '@/lib/chat-sessions/detached'

import type { ChatTurnContext } from './types'

const switchInputSchema = z.object({
  reason: z
    .string()
    .optional()
    .describe('Brief note on why workspace webapp tools are needed.'),
})

const APP_BUILDER_DISCOVERY_NAMES = [
  ...WORKSPACE_CODE_TOOL_NAMES,
  ...WORKSPACE_WEBAPP_TOOL_NAMES,
] as const

const discoveryNamesJson = JSON.stringify([...APP_BUILDER_DISCOVERY_NAMES])

/**
 * Eager tool when App mode is off: enables persisted app harness and tells the model
 * how to unlock lazy workspace code + webapp helper tools (same pattern as switch_to_code_agent).
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
    description: `Switch this chat to **App agent mode**: workspace **Vite + React** app at \`.braian/webapp\` (preview in sidebar **Webapp** and the chat artifact). The user does not need to select App mode in the UI manually.

**Required workflow after this tool returns successfully:** immediately call \`__lazy__tool__discovery__\` with argument toolNames exactly: ${discoveryNamesJson}. Then use file/shell tools for \`.braian/webapp/\`, \`init_workspace_webapp\` when the template is missing, and \`read_workspace_webapp_dev_logs\` when diagnosing the managed dev server.

**Sub-routes (mandatory):** For any new or "simple" app the user asks for, implement it on a **dedicated path** (e.g. \`/email-checker\`): new file under \`src/pages/\`, new entry in \`src/app-routes.tsx\`, then \`set_workspace_webapp_preview_path\` to that path. **Never** put the feature on \`/\` or replace \`MyAppsLandingPage\` / the root route with feature UI.

**Interactive UI:** Implement real components under **\`.braian/webapp/src/**\`. **Do not** run \`npm run dev\` via the shell tool. The user starts the dev preview from Braian.

Call this when the user wants an in-workspace webapp or Vite-based UI.`,
    inputSchema: switchInputSchema,
  }).server(async (args) => {
    switchInputSchema.parse(args)
    context.onAgentModeChange?.('app')
    return {
      ok: true as const,
      message:
        'App agent mode is enabled. Put every new mini-app on its own route (pages/ + app-routes.tsx); never replace the `/` landing with feature UI. Next: call __lazy__tool__discovery__ with the toolNames array below.',
      discoveryToolNames: [...APP_BUILDER_DISCOVERY_NAMES],
    }
  })
}
