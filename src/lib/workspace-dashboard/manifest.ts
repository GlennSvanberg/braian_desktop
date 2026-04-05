import {
  DASHBOARD_BOARD_RELATIVE_PATH,
  DASHBOARD_PAGES_DIR_RELATIVE_PATH,
} from './constants'
import {
  type DashboardManifest,
  type WorkspacePage,
  dashboardManifestSchema,
  formatZodError,
  workspacePageSchema,
} from './schema'

import {
  workspaceListDir,
  workspaceReadTextFile,
} from '@/lib/workspace-api'
import { isTauri } from '@/lib/tauri-env'

export function defaultDashboardManifest(): DashboardManifest {
  return {
    schemaVersion: 1,
    regions: {
      insights: [],
      links: [],
      main: [],
    },
  }
}

export function parseDashboardManifestJson(
  raw: string,
):
  | { ok: true; data: DashboardManifest }
  | { ok: false; error: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Invalid JSON',
    }
  }
  const r = dashboardManifestSchema.safeParse(parsed)
  if (!r.success) {
    return { ok: false, error: formatZodError(r.error) }
  }
  return { ok: true, data: r.data }
}

export function parseWorkspacePageJson(
  raw: string,
): { ok: true; data: WorkspacePage } | { ok: false; error: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Invalid JSON',
    }
  }
  const r = workspacePageSchema.safeParse(parsed)
  if (!r.success) {
    return { ok: false, error: formatZodError(r.error) }
  }
  return { ok: true, data: r.data }
}

export function serializeDashboardManifest(m: DashboardManifest): string {
  const stamped: DashboardManifest = {
    ...m,
    updatedAtMs: Date.now(),
  }
  return `${JSON.stringify(stamped, null, 2)}\n`
}

export function serializeWorkspacePage(p: WorkspacePage): string {
  return `${JSON.stringify(p, null, 2)}\n`
}

export function collectPageIdsFromManifest(m: DashboardManifest): string[] {
  const ids = new Set<string>()
  for (const t of m.regions.links) {
    if (t.kind === 'page_link') ids.add(t.pageId)
  }
  for (const t of m.regions.main) {
    if (t.kind === 'page_link') ids.add(t.pageId)
  }
  return [...ids].sort()
}

export async function listWorkspaceDashboardPageIds(
  workspaceId: string,
): Promise<string[]> {
  const fromDisk = new Set<string>()
  if (!isTauri()) return []

  try {
    const entries = await workspaceListDir(
      workspaceId,
      DASHBOARD_PAGES_DIR_RELATIVE_PATH,
    )
    for (const e of entries) {
      if (e.isDir || !e.name.endsWith('.json')) continue
      const base = e.name.slice(0, -'.json'.length)
      if (base.length > 0) fromDisk.add(base)
    }
  } catch {
    /* dir may not exist */
  }

  try {
    const { text } = await workspaceReadTextFile(
      workspaceId,
      DASHBOARD_BOARD_RELATIVE_PATH,
      256 * 1024,
    )
    const parsed = parseDashboardManifestJson(text)
    if (parsed.ok) {
      for (const id of collectPageIdsFromManifest(parsed.data)) {
        fromDisk.add(id)
      }
    }
  } catch {
    /* board missing */
  }

  return [...fromDisk].sort()
}

/** Validate manifest shape from unknown (e.g. tool args). */
export function safeParseDashboardManifest(
  input: unknown,
): ReturnType<typeof dashboardManifestSchema.safeParse> {
  return dashboardManifestSchema.safeParse(input)
}

export function safeParseWorkspacePage(
  input: unknown,
): ReturnType<typeof workspacePageSchema.safeParse> {
  return workspacePageSchema.safeParse(input)
}
