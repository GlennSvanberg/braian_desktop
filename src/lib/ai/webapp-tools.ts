import { toolDefinition } from '@tanstack/ai'
import { z } from 'zod'

import { isNonWorkspaceScopedSessionId } from '@/lib/chat-sessions/detached'
import {
  workspaceWebappDevLogs,
  workspaceWebappInit,
  workspaceWebappPreviewPathSet,
} from '@/lib/workspace-api'

import type { ChatTurnContext } from './types'

export const WORKSPACE_WEBAPP_TOOL_NAMES = [
  'init_workspace_webapp',
  'read_workspace_webapp_dev_logs',
  'set_workspace_webapp_preview_path',
] as const

export type BuildWorkspaceWebappToolsOptions = {
  lazy?: boolean
}

const initSchema = z.object({
  overwrite: z
    .boolean()
    .optional()
    .describe(
      'If true, replace existing .braian/webapp files from the bundled template.',
    ),
})

const readLogsSchema = z.object({})

const setPreviewPathSchema = z.object({
  path: z
    .string()
    .describe(
      'Preview iframe route. Must start with /. For a mini-app you just built, use THAT app path (e.g. /email-checker, /calculator) — never use / to showcase new feature UI; / is only the My apps index. Use / only when you intentionally want the landing page.',
    ),
})

export function buildWorkspaceWebappTools(
  context: ChatTurnContext | undefined,
  options?: BuildWorkspaceWebappToolsOptions,
) {
  if (!context?.workspaceId || isNonWorkspaceScopedSessionId(context.workspaceId)) {
    return []
  }

  const lazy =
    options?.lazy ?? (context?.agentMode ?? 'document') !== 'app'

  const workspaceId = context.workspaceId
  const lazyOpt = lazy ? ({ lazy: true } as const) : {}

  const initTool = toolDefinition({
    name: 'init_workspace_webapp',
    description:
      'Copy the bundled Vite + React + TypeScript multi-page template into .braian/webapp when package.json is missing or the user asked to reset. The template keeps `/` as My apps only; every new feature belongs on its own sub-route (e.g. /email-checker) via app-routes.tsx + src/pages/. Use overwrite=true only when replacing an existing webapp. After init, run npm install via run_workspace_shell with cwd ".braian/webapp".',
    inputSchema: initSchema,
    ...lazyOpt,
  })

  const logsTool = toolDefinition({
    name: 'read_workspace_webapp_dev_logs',
    description:
      'Read recent stdout/stderr from the workspace Vite dev server Braian started (ring buffer, last ~256KB). Empty if the dev server was never started this session or produced no output yet.',
    inputSchema: readLogsSchema,
    ...lazyOpt,
  })

  const previewPathTool = toolDefinition({
    name: 'set_workspace_webapp_preview_path',
    description:
      'Set the preview iframe route. After building or editing a mini-app, set this to that app path (e.g. /email-checker) — not /. Using / is only for the My apps index; do not point / at new feature UI you implemented.',
    inputSchema: setPreviewPathSchema,
    ...lazyOpt,
  })

  return [
    initTool.server(async (args) => {
      initSchema.parse(args)
      try {
        const r = await workspaceWebappInit({
          workspaceId,
          overwrite: args.overwrite === true,
        })
        return {
          ok: true as const,
          copiedFiles: r.copiedFiles,
          skippedExisting: r.skippedExisting,
        }
      } catch (e) {
        return {
          ok: false as const,
          error: e instanceof Error ? e.message : String(e),
        }
      }
    }),
    logsTool.server(async () => {
      readLogsSchema.parse({})
      try {
        const { text } = await workspaceWebappDevLogs(workspaceId)
        return { ok: true as const, text }
      } catch (e) {
        return {
          ok: false as const,
          error: e instanceof Error ? e.message : String(e),
        }
      }
    }),
    previewPathTool.server(async (args) => {
      const parsed = setPreviewPathSchema.parse(args)
      try {
        const { previewPath } = await workspaceWebappPreviewPathSet({
          workspaceId,
          path: parsed.path,
        })
        return { ok: true as const, previewPath }
      } catch (e) {
        return {
          ok: false as const,
          error: e instanceof Error ? e.message : String(e),
        }
      }
    }),
  ]
}
