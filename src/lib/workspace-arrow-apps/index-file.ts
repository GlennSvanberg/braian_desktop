import {
  ARROW_APPS_DIR,
  arrowAppMainCssRelative,
  arrowAppMainTsRelative,
} from '@/lib/workspace-arrow-apps/constants'

export type ArrowAppIndexEntry = {
  id: string
  title: string
  updatedAtMs: number
}

export type ArrowAppsIndexFile = {
  schemaVersion: 1
  generatedAtMs: number
  /** Which app id the workspace shell shows in App mode / Apps tab. */
  activeAppId: string | null
  apps: ArrowAppIndexEntry[]
}

const DEFAULT_INDEX = (): ArrowAppsIndexFile => ({
  schemaVersion: 1,
  generatedAtMs: Date.now(),
  activeAppId: null,
  apps: [],
})

/** Slug: lowercase letters, digits, single hyphens (no leading/trailing hyphen). */
export function normalizeArrowAppId(raw: string): string {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
  const collapsed = s.replace(/-+/g, '-').replace(/^-/, '').replace(/-$/, '')
  if (!collapsed || !/^[a-z0-9]/.test(collapsed)) {
    throw new Error(
      'App id must start with a letter or digit and contain only a-z, 0-9, and hyphens.',
    )
  }
  return collapsed
}

export function parseArrowAppsIndexJson(raw: string): ArrowAppsIndexFile {
  try {
    const o = JSON.parse(raw) as Partial<ArrowAppsIndexFile>
    if (o.schemaVersion !== 1 || !Array.isArray(o.apps)) {
      return DEFAULT_INDEX()
    }
    const apps: ArrowAppIndexEntry[] = o.apps
      .map((e) => ({
        id: typeof e.id === 'string' ? e.id : '',
        title: typeof e.title === 'string' ? e.title : '',
        updatedAtMs:
          typeof e.updatedAtMs === 'number' && Number.isFinite(e.updatedAtMs)
            ? e.updatedAtMs
            : 0,
      }))
      .filter((e) => e.id.length > 0)
    return {
      schemaVersion: 1,
      generatedAtMs:
        typeof o.generatedAtMs === 'number' && Number.isFinite(o.generatedAtMs)
          ? o.generatedAtMs
          : Date.now(),
      activeAppId:
        typeof o.activeAppId === 'string' && o.activeAppId.trim()
          ? o.activeAppId.trim()
          : null,
      apps,
    }
  } catch {
    return DEFAULT_INDEX()
  }
}

export function stringifyArrowAppsIndex(index: ArrowAppsIndexFile): string {
  const out: ArrowAppsIndexFile = {
    ...index,
    generatedAtMs: Date.now(),
  }
  return `${JSON.stringify(out, null, 2)}\n`
}

/** Relative paths for all files that belong to one app (for deletes). */
export function arrowAppRelativePaths(appId: string): string[] {
  const base = `${ARROW_APPS_DIR}/${appId}`
  return [
    arrowAppMainTsRelative(appId),
    arrowAppMainCssRelative(appId),
    `${base}/manifest.json`,
  ]
}

export { ARROW_APPS_INDEX_PATH } from '@/lib/workspace-arrow-apps/constants'
