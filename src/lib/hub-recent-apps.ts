import { workspaceReadTextFile, workspaceWriteTextFile } from '@/lib/workspace-api'
import { isTauri } from '@/lib/tauri-env'

const HUB_RECENT_APPS_PATH = '.braian/hub-recent-apps.json'
const ARROW_APPS_INDEX_PATH = '.braian/arrow-apps.json'
const READ_MAX = 64 * 1024
const MAX_ENTRIES = 24

export type HubRecentAppEntry = {
  path: string
  label: string
  lastAccessedAtMs: number
}

type HubRecentAppsFileV1 = {
  schemaVersion: 1
  entries: HubRecentAppEntry[]
}

function normalizePath(p: string): string {
  const t = p.trim().replace(/\\/g, '/')
  if (!t) return '/'
  return t.startsWith('/') ? t : `/${t}`
}

function parseArrowAppsForLabels(
  raw: string,
): { path: string; label: string }[] {
  try {
    const o = JSON.parse(raw) as {
      apps?: { id?: string; title?: string }[]
    }
    const apps = o.apps
    if (!Array.isArray(apps)) return []
    return apps
      .map((a) => {
        const id = typeof a.id === 'string' ? a.id.trim() : ''
        const title = typeof a.title === 'string' ? a.title.trim() : ''
        if (!id) return { path: '', label: '' }
        const path = normalizePath(id.startsWith('/') ? id : `/${id}`)
        return { path, label: title || id }
      })
      .filter((r) => r.path && r.label)
  } catch {
    return []
  }
}

async function resolveLabelFromManifest(
  workspaceId: string,
  path: string,
): Promise<string | null> {
  try {
    const { text } = await workspaceReadTextFile(
      workspaceId,
      ARROW_APPS_INDEX_PATH,
      READ_MAX,
    )
    const routes = parseArrowAppsForLabels(text)
    const hit = routes.find((r) => r.path === path)
    return hit?.label ?? null
  } catch {
    return null
  }
}

/** Persisted list of workspace app routes the user recently opened (preview or dashboard). */
export async function loadHubRecentApps(
  workspaceId: string,
): Promise<HubRecentAppEntry[]> {
  if (!isTauri()) return []
  try {
    const { text } = await workspaceReadTextFile(
      workspaceId,
      HUB_RECENT_APPS_PATH,
      READ_MAX,
    )
    const parsed = JSON.parse(text) as HubRecentAppsFileV1
    if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed.entries)) {
      return []
    }
    return parsed.entries
      .filter(
        (e) =>
          e &&
          typeof e.path === 'string' &&
          typeof e.label === 'string' &&
          typeof e.lastAccessedAtMs === 'number',
      )
      .map((e) => ({
        path: normalizePath(e.path),
        label: e.label.trim() || normalizePath(e.path),
        lastAccessedAtMs: e.lastAccessedAtMs,
      }))
  } catch {
    return []
  }
}

/**
 * Record that the user opened a workspace Arrow app (path like `/my-app`).
 * Call after `set_active_arrow_app` or when opening an app from the dashboard.
 */
export async function touchHubRecentApp(
  workspaceId: string,
  path: string,
  labelHint?: string | null,
): Promise<void> {
  if (!isTauri()) return
  const norm = normalizePath(path)
  const fromManifest = await resolveLabelFromManifest(workspaceId, norm)
  const label =
    (labelHint?.trim() && labelHint.trim()) ||
    fromManifest ||
    (norm === '/' ? 'App index' : norm)

  let entries = await loadHubRecentApps(workspaceId)
  entries = entries.filter((e) => e.path !== norm)
  const now = Date.now()
  entries.unshift({
    path: norm,
    label,
    lastAccessedAtMs: now,
  })
  if (entries.length > MAX_ENTRIES) {
    entries = entries.slice(0, MAX_ENTRIES)
  }

  const doc: HubRecentAppsFileV1 = { schemaVersion: 1, entries }
  try {
    await workspaceWriteTextFile(
      workspaceId,
      HUB_RECENT_APPS_PATH,
      `${JSON.stringify(doc, null, 2)}\n`,
    )
  } catch {
    /* ignore */
  }
}
