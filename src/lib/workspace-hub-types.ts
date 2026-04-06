/** `.braian/dashboard.json` — section `type` values the shell understands. */
export type HubSectionType =
  | 'welcome'
  | 'continue'
  | 'apps'
  | 'recent_files'
  | 'kpis'
  | 'insights'

export type HubDashboardSection = {
  id: string
  type: HubSectionType
  enabled: boolean
}

export type HubDashboardManifest = {
  schemaVersion: number
  sections: HubDashboardSection[]
}

export type WebappAppRouteEntry = {
  path: string
  label: string
}

export type RecentFileEntry = {
  relativePath: string
  lastAccessedAtMs: number
  label?: string | null
}

export type HubInsightItem = {
  id: string
  text: string
  createdAtMs: number
  conversationId?: string | null
}

export type WorkspaceHubSnapshot = {
  dashboard: HubDashboardManifest | null
  webappAppRoutes: WebappAppRouteEntry[]
  recentFiles: RecentFileEntry[]
  insightItems: HubInsightItem[]
}

export const DEFAULT_HUB_SECTIONS: HubDashboardSection[] = [
  { id: 'welcome', type: 'welcome', enabled: true },
  { id: 'continue', type: 'continue', enabled: true },
  { id: 'apps', type: 'apps', enabled: true },
  { id: 'recent', type: 'recent_files', enabled: true },
  { id: 'kpis', type: 'kpis', enabled: true },
  { id: 'insights', type: 'insights', enabled: true },
]

const KNOWN_TYPES = new Set<HubSectionType>([
  'welcome',
  'continue',
  'apps',
  'recent_files',
  'kpis',
  'insights',
])

function isHubSectionType(s: string): s is HubSectionType {
  return KNOWN_TYPES.has(s as HubSectionType)
}

/** Merge on-disk manifest with defaults; drop unknown types and disabled sections. */
export function resolveHubSections(
  dashboard: HubDashboardManifest | null,
): HubDashboardSection[] {
  const raw =
    dashboard?.sections?.length && dashboard.schemaVersion >= 1
      ? dashboard.sections
      : DEFAULT_HUB_SECTIONS
  const out: HubDashboardSection[] = []
  for (const s of raw) {
    if (!s.enabled) continue
    const t = s.type
    if (typeof t !== 'string' || !isHubSectionType(t)) continue
    out.push({
      id: typeof s.id === 'string' && s.id ? s.id : t,
      type: t,
      enabled: true,
    })
  }
  return out.length > 0 ? out : DEFAULT_HUB_SECTIONS
}
