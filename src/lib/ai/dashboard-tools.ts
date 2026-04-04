import { toolDefinition } from '@tanstack/ai'
import { z } from 'zod'

import {
  DASHBOARD_BOARD_RELATIVE_PATH,
  DASHBOARD_PAGES_DIR_RELATIVE_PATH,
  dashboardPageRelativePath,
  parseDashboardManifestJson,
  parseWorkspacePageJson,
  serializeDashboardManifest,
  serializeWorkspacePage,
} from '@/lib/workspace-dashboard'
import {
  workspaceListDir,
  workspaceReadTextFile,
  workspaceWriteTextFile,
} from '@/lib/workspace-api'

import { isNonWorkspaceScopedSessionId } from '@/lib/chat-sessions/detached'

import type { ChatTurnContext } from './types'

export const DASHBOARD_TOOL_NAMES = [
  'read_workspace_dashboard',
  'apply_workspace_dashboard',
  'upsert_workspace_page',
] as const

const DASHBOARD_TOOL_NAME_SET = new Set<string>([...DASHBOARD_TOOL_NAMES])

/** True when a `__lazy__tool__discovery__` result exposes a workspace dashboard tool. */
export function discoveryResultIncludesDashboardTools(
  result: string | undefined,
): boolean {
  if (result == null || result.trim() === '') return false
  let parsed: unknown
  try {
    parsed = JSON.parse(result) as unknown
  } catch {
    return false
  }
  if (!parsed || typeof parsed !== 'object') return false
  const tools = (parsed as { tools?: unknown }).tools
  if (!Array.isArray(tools)) return false
  for (const t of tools) {
    if (
      t &&
      typeof t === 'object' &&
      typeof (t as { name?: string }).name === 'string' &&
      DASHBOARD_TOOL_NAME_SET.has((t as { name: string }).name)
    ) {
      return true
    }
  }
  return false
}

export type BuildDashboardToolsOptions = {
  /** When true, tools are hidden until `__lazy__tool__discovery__` (after switch_to_app_builder). */
  lazy?: boolean
}

const readDashboardSchema = z.object({})

/** OpenAI structured tool schemas cannot use oneOf; use a JSON string and validate server-side. */
const MAX_MANIFEST_JSON_CHARS = 512_000

const applyDashboardSchema = z.object({
  manifestJson: z
    .string()
    .min(1)
    .max(MAX_MANIFEST_JSON_CHARS)
    .describe(
      'Single JSON string of the full board manifest (schemaVersion: 1, regions.insights, regions.links, regions.main). Must be valid JSON, not an object literal in another field.',
    ),
})

const upsertPageSchema = z.object({
  pageJson: z
    .string()
    .min(1)
    .max(MAX_MANIFEST_JSON_CHARS)
    .describe(
      'Single JSON string of the page (schemaVersion, pageId, title, optional description, tiles). pageId must match the URL slug (e.g. hello-world).',
    ),
})

export function buildDashboardTools(
  context: ChatTurnContext | undefined,
  options?: BuildDashboardToolsOptions,
) {
  if (!context?.workspaceId || isNonWorkspaceScopedSessionId(context.workspaceId)) {
    return []
  }

  const lazy = options?.lazy ?? context.appHarnessEnabled !== true

  const workspaceId = context.workspaceId
  const lazyOpt = lazy ? ({ lazy: true } as const) : {}

  const readTool = toolDefinition({
    name: 'read_workspace_dashboard',
    description: `Read and validate the workspace main dashboard (.braian/dashboard/board.json) and list page ids under .braian/dashboard/pages/. Use before apply_workspace_dashboard to merge carefully.`,
    inputSchema: readDashboardSchema,
    ...lazyOpt,
  })

  const applyTool = toolDefinition({
    name: 'apply_workspace_dashboard',
    description: `Replace the entire dashboard manifest on disk. Pass argument manifestJson: a single string containing valid JSON (schemaVersion: 1, regions). Sets updatedAtMs on write. Read the board first with read_workspace_dashboard, merge your changes into the full manifest, then stringify once for manifestJson.`,
    inputSchema: applyDashboardSchema,
    ...lazyOpt,
  })

  const upsertPageTool = toolDefinition({
    name: 'upsert_workspace_page',
    description: `Create or replace .braian/dashboard/pages/<pageId>.json. Pass pageJson: one string of valid JSON (schemaVersion, pageId, title, tiles). Opens at /dashboard/page/<pageId>.`,
    inputSchema: upsertPageSchema,
    ...lazyOpt,
  })

  return [
    readTool.server(async () => {
      let board: unknown = null
      let boardError: string | null = null
      try {
        const { text } = await workspaceReadTextFile(
          workspaceId,
          DASHBOARD_BOARD_RELATIVE_PATH,
          512 * 1024,
        )
        const parsed = parseDashboardManifestJson(text)
        if (parsed.ok) {
          board = parsed.data
        } else {
          boardError = parsed.error
        }
      } catch (e) {
        boardError =
          e instanceof Error ? e.message : 'board.json not found or unreadable'
      }

      const pageIds: string[] = []
      try {
        const entries = await workspaceListDir(
          workspaceId,
          DASHBOARD_PAGES_DIR_RELATIVE_PATH,
        )
        for (const e of entries) {
          if (e.isDir || !e.name.endsWith('.json')) continue
          const base = e.name.slice(0, -'.json'.length)
          if (base.length > 0) pageIds.push(base)
        }
        pageIds.sort()
      } catch {
        /* pages dir may not exist yet */
      }

      return {
        ok: true as const,
        board,
        boardParseError: boardError,
        pageIds,
        boardPath: DASHBOARD_BOARD_RELATIVE_PATH,
        pagesDir: DASHBOARD_PAGES_DIR_RELATIVE_PATH,
      }
    }),
    applyTool.server(async (args) => {
      const parsed = applyDashboardSchema.safeParse(args)
      if (!parsed.success) {
        return {
          ok: false as const,
          error: parsed.error.issues.map((i) => i.message).join('; '),
        }
      }
      const manifestResult = parseDashboardManifestJson(parsed.data.manifestJson)
      if (!manifestResult.ok) {
        return { ok: false as const, error: manifestResult.error }
      }
      try {
        const text = serializeDashboardManifest(manifestResult.data)
        await workspaceWriteTextFile(
          workspaceId,
          DASHBOARD_BOARD_RELATIVE_PATH,
          text,
        )
        return {
          ok: true as const,
          path: DASHBOARD_BOARD_RELATIVE_PATH,
          message: 'Dashboard saved. User can open Dashboard in the sidebar.',
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return { ok: false as const, error: msg }
      }
    }),
    upsertPageTool.server(async (args) => {
      const parsed = upsertPageSchema.safeParse(args)
      if (!parsed.success) {
        return {
          ok: false as const,
          error: parsed.error.issues.map((i) => i.message).join('; '),
        }
      }
      const pageResult = parseWorkspacePageJson(parsed.data.pageJson)
      if (!pageResult.ok) {
        return { ok: false as const, error: pageResult.error }
      }
      const page = pageResult.data
      const rel = dashboardPageRelativePath(page.pageId)
      try {
        const text = serializeWorkspacePage(page)
        await workspaceWriteTextFile(workspaceId, rel, text)
        return {
          ok: true as const,
          path: rel,
          inAppRoute: `/dashboard/page/${page.pageId}`,
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return { ok: false as const, error: msg }
      }
    }),
  ]
}
