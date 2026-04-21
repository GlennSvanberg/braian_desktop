import { toolDefinition } from '@tanstack/ai'
import { z } from 'zod'

import { touchHubRecentApp } from '@/lib/hub-recent-apps'
import { isNonWorkspaceScopedSessionId } from '@/lib/chat-sessions/detached'
import {
  fetchArrowWorkspaceBundle,
  pushArrowAppUpsert,
  pushArrowSoftDeleteApp,
  pushArrowWorkspaceMeta,
} from '@/lib/cloud/arrow-apps-sync'
import {
  ARROW_APPS_DIR,
  arrowAppMainTsRelative,
  arrowAppManifestRelative,
} from '@/lib/workspace-arrow-apps/constants'
import {
  normalizeArrowAppId,
  type ArrowAppsIndexFile,
} from '@/lib/workspace-arrow-apps/index-file'
import {
  workspaceDeleteEntry,
  workspaceReadTextFile,
  workspaceWriteTextFile,
} from '@/lib/workspace-api'
import { isTauri } from '@/lib/tauri-env'

import type { ChatTurnContext } from './types'

export const WORKSPACE_ARROW_APP_TOOL_NAMES = [
  'list_arrow_apps',
  'read_arrow_app',
  'write_arrow_app',
  'delete_arrow_app',
  'set_active_arrow_app',
] as const

export type BuildArrowAppToolsOptions = {
  lazy?: boolean
}

const listSchema = z.object({})

const readSchema = z.object({
  appId: z
    .string()
    .describe('Arrow app id (slug under .braian/arrow-apps/<appId>/).'),
})

const writeSchema = z.object({
  appId: z
    .string()
    .describe(
      'Stable id for this app (lowercase slug, e.g. email-checker). Creates .braian/arrow-apps/<appId>/.',
    ),
  title: z
    .string()
    .describe('Short human title for dashboard lists (e.g. "Email checker").'),
  mainTs: z
    .string()
    .describe(
      'Full contents of main.ts: Arrow sandbox entry with default export html`...` or component. Use reactive, html, output(); no JSX.',
    ),
  mainCss: z
    .string()
    .optional()
    .describe('Optional stylesheet text for main.css.'),
})

const deleteSchema = z.object({
  appId: z.string().describe('App id to remove from disk and index.'),
})

const setActiveSchema = z.object({
  appId: z
    .string()
    .describe(
      'App id to show in the workspace Apps panel / App-mode artifact (must exist in index).',
    ),
})

async function readIndex(workspaceId: string): Promise<ArrowAppsIndexFile> {
  const { loadArrowAppsIndex } = await import('@/lib/workspace-arrow-apps/io')
  return loadArrowAppsIndex(workspaceId)
}

async function writeIndex(workspaceId: string, index: ArrowAppsIndexFile) {
  const { saveArrowAppsIndex } = await import('@/lib/workspace-arrow-apps/io')
  await saveArrowAppsIndex(workspaceId, index)
}

export function buildArrowAppTools(
  context: ChatTurnContext | undefined,
  options?: BuildArrowAppToolsOptions,
) {
  if (!context?.workspaceId || isNonWorkspaceScopedSessionId(context.workspaceId)) {
    return []
  }

  const lazy =
    options?.lazy ?? (context?.agentMode ?? 'document') !== 'app'

  const workspaceId = context.workspaceId
  const lazyOpt = lazy ? ({ lazy: true } as const) : {}

  const listTool = toolDefinition({
    name: 'list_arrow_apps',
    description:
      'List Arrow sandbox apps in this workspace (.braian/arrow-apps.json + app folders). Use before editing to pick an appId.',
    inputSchema: listSchema,
    ...lazyOpt,
  })

  const readTool = toolDefinition({
    name: 'read_arrow_app',
    description:
      'Read main.ts, main.css (if any), and per-app manifest for one Arrow app id.',
    inputSchema: readSchema,
    ...lazyOpt,
  })

  const writeTool = toolDefinition({
    name: 'write_arrow_app',
    description:
      'Create or update an Arrow JS sandbox app: writes main.ts, optional main.css, updates .braian/arrow-apps.json. After changes, the UI reloads on the next chat turn completion or when the user focuses the app panel.',
    inputSchema: writeSchema,
    ...lazyOpt,
  })

  const deleteTool = toolDefinition({
    name: 'delete_arrow_app',
    description:
      'Delete an Arrow app folder and remove it from .braian/arrow-apps.json.',
    inputSchema: deleteSchema,
    ...lazyOpt,
  })

  const setActiveTool = toolDefinition({
    name: 'set_active_arrow_app',
    description:
      'Set which Arrow app id is selected for the workspace Apps dashboard and App-mode side panel.',
    inputSchema: setActiveSchema,
    ...lazyOpt,
  })

  return [
    listTool.server(async () => {
      listSchema.parse({})
      try {
        const index = await readIndex(workspaceId)
        return { ok: true as const, index }
      } catch (e) {
        return {
          ok: false as const,
          error: e instanceof Error ? e.message : String(e),
        }
      }
    }),
    readTool.server(async (args) => {
      const { appId: raw } = readSchema.parse(args)
      let appId: string
      try {
        appId = normalizeArrowAppId(raw)
      } catch (e) {
        return {
          ok: false as const,
          error: e instanceof Error ? e.message : String(e),
        }
      }
      try {
        if (!isTauri()) {
          const bundle = await fetchArrowWorkspaceBundle(workspaceId)
          const row = bundle?.apps.find((a) => a.appId === appId)
          if (!row) {
            return {
              ok: false as const,
              error: `Unknown or unavailable Arrow app id "${appId}".`,
            }
          }
          return {
            ok: true as const,
            appId,
            mainTs: row.mainTs,
            mainCss: row.mainCss,
            manifestJson: row.manifestJson,
          }
        }
        const mainTs = await workspaceReadTextFile(
          workspaceId,
          arrowAppMainTsRelative(appId),
          2 * 1024 * 1024,
        )
        let mainCss = ''
        try {
          const css = await workspaceReadTextFile(
            workspaceId,
            `${ARROW_APPS_DIR}/${appId}/main.css`,
            256 * 1024,
          )
          mainCss = css.text
        } catch {
          mainCss = ''
        }
        let manifestJson = ''
        try {
          const m = await workspaceReadTextFile(
            workspaceId,
            arrowAppManifestRelative(appId),
            64 * 1024,
          )
          manifestJson = m.text
        } catch {
          manifestJson = ''
        }
        return {
          ok: true as const,
          appId,
          mainTs: mainTs.text,
          mainCss,
          manifestJson,
        }
      } catch (e) {
        return {
          ok: false as const,
          error: e instanceof Error ? e.message : String(e),
        }
      }
    }),
    writeTool.server(async (args) => {
      const parsed = writeSchema.parse(args)
      let appId: string
      try {
        appId = normalizeArrowAppId(parsed.appId)
      } catch (e) {
        return {
          ok: false as const,
          error: e instanceof Error ? e.message : String(e),
        }
      }
      try {
        const now = Date.now()
        const index = await readIndex(workspaceId)
        const others = index.apps.filter((a) => a.id !== appId)
        const next: ArrowAppsIndexFile = {
          schemaVersion: 1,
          generatedAtMs: now,
          activeAppId: index.activeAppId ?? appId,
          apps: [
            ...others,
            {
              id: appId,
              title: parsed.title.trim() || appId,
              updatedAtMs: now,
            },
          ].sort((a, b) => a.id.localeCompare(b.id)),
        }
        const manifestObj = {
          schemaVersion: 1,
          id: appId,
          title: parsed.title.trim() || appId,
          updatedAtMs: now,
        }
        const manifestJson = `${JSON.stringify(manifestObj, null, 2)}\n`
        if (!isTauri()) {
          await pushArrowAppUpsert({
            workspaceClientId: workspaceId,
            appId,
            title: parsed.title.trim() || appId,
            mainTs: parsed.mainTs,
            mainCss:
              parsed.mainCss !== undefined && parsed.mainCss.length > 0
                ? parsed.mainCss
                : undefined,
            manifestJson,
          })
          await pushArrowWorkspaceMeta({
            workspaceClientId: workspaceId,
            activeAppId: next.activeAppId,
          })
        } else {
          await workspaceWriteTextFile(
            workspaceId,
            arrowAppMainTsRelative(appId),
            parsed.mainTs,
          )
          if (parsed.mainCss !== undefined && parsed.mainCss.length > 0) {
            await workspaceWriteTextFile(
              workspaceId,
              `${ARROW_APPS_DIR}/${appId}/main.css`,
              parsed.mainCss,
            )
          }
          await workspaceWriteTextFile(
            workspaceId,
            arrowAppManifestRelative(appId),
            manifestJson,
          )
          await writeIndex(workspaceId, next)
          await pushArrowAppUpsert({
            workspaceClientId: workspaceId,
            appId,
            title: parsed.title.trim() || appId,
            mainTs: parsed.mainTs,
            mainCss:
              parsed.mainCss !== undefined && parsed.mainCss.length > 0
                ? parsed.mainCss
                : undefined,
            manifestJson,
          })
        }
        await touchHubRecentApp(workspaceId, `/${appId}`, parsed.title)
        return { ok: true as const, appId }
      } catch (e) {
        return {
          ok: false as const,
          error: e instanceof Error ? e.message : String(e),
        }
      }
    }),
    deleteTool.server(async (args) => {
      const { appId: raw } = deleteSchema.parse(args)
      let appId: string
      try {
        appId = normalizeArrowAppId(raw)
      } catch (e) {
        return {
          ok: false as const,
          error: e instanceof Error ? e.message : String(e),
        }
      }
      try {
        const index = await readIndex(workspaceId)
        const apps = index.apps.filter((a) => a.id !== appId)
        const next: ArrowAppsIndexFile = {
          schemaVersion: 1,
          generatedAtMs: Date.now(),
          activeAppId:
            index.activeAppId === appId
              ? apps[0]?.id ?? null
              : index.activeAppId,
          apps,
        }
        if (!isTauri()) {
          await pushArrowSoftDeleteApp({
            workspaceClientId: workspaceId,
            appId,
          })
          await pushArrowWorkspaceMeta({
            workspaceClientId: workspaceId,
            activeAppId: next.activeAppId,
          })
        } else {
          try {
            await workspaceDeleteEntry(
              workspaceId,
              `${ARROW_APPS_DIR}/${appId}`,
            )
          } catch {
            /* folder may be missing */
          }
          await writeIndex(workspaceId, next)
          await pushArrowSoftDeleteApp({
            workspaceClientId: workspaceId,
            appId,
          })
        }
        return { ok: true as const, appId }
      } catch (e) {
        return {
          ok: false as const,
          error: e instanceof Error ? e.message : String(e),
        }
      }
    }),
    setActiveTool.server(async (args) => {
      const { appId: raw } = setActiveSchema.parse(args)
      let appId: string
      try {
        appId = normalizeArrowAppId(raw)
      } catch (e) {
        return {
          ok: false as const,
          error: e instanceof Error ? e.message : String(e),
        }
      }
      try {
        const index = await readIndex(workspaceId)
        if (!index.apps.some((a) => a.id === appId)) {
          return {
            ok: false as const,
            error: `Unknown app id "${appId}". Use list_arrow_apps or write_arrow_app first.`,
          }
        }
        const title = index.apps.find((a) => a.id === appId)?.title ?? appId
        const next: ArrowAppsIndexFile = {
          ...index,
          activeAppId: appId,
          generatedAtMs: Date.now(),
        }
        if (!isTauri()) {
          await pushArrowWorkspaceMeta({
            workspaceClientId: workspaceId,
            activeAppId: appId,
          })
        } else {
          await writeIndex(workspaceId, next)
        }
        await touchHubRecentApp(workspaceId, `/${appId}`, title)
        return { ok: true as const, activeAppId: appId }
      } catch (e) {
        return {
          ok: false as const,
          error: e instanceof Error ? e.message : String(e),
        }
      }
    }),
  ]
}
