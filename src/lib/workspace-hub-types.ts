/** `.braian/dashboard.json` — section `type` values the shell understands. */
export type HubSectionType =
  | 'welcome'
  /** Replaces `welcome` in defaults — workspace name + memory context (no generic greeting). */
  | 'at_a_glance'
  | 'continue'
  | 'apps'
  | 'recent_files'
  | 'recent_documents'
  | 'recent_apps'
  | 'memory_queue'
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
  { id: 'glance', type: 'at_a_glance', enabled: true },
  { id: 'memory_queue', type: 'memory_queue', enabled: true },
  { id: 'continue', type: 'continue', enabled: true },
  { id: 'recent_apps', type: 'recent_apps', enabled: true },
  { id: 'apps', type: 'apps', enabled: true },
  { id: 'recent_docs', type: 'recent_documents', enabled: true },
  { id: 'kpis', type: 'kpis', enabled: true },
  { id: 'insights', type: 'insights', enabled: true },
]

const KNOWN_TYPES = new Set<HubSectionType>([
  'welcome',
  'at_a_glance',
  'continue',
  'apps',
  'recent_files',
  'recent_documents',
  'recent_apps',
  'memory_queue',
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
