import type { WorkspaceArtifactPayload } from '@/lib/artifacts/types'

import type { ArtifactTab, ChatThreadState } from './types'
import { DEFAULT_CHAT_THREAD } from './types'

/** Persisted wrapper when multiple side-panel artifacts are open (not an LLM stream kind). */
export const ARTIFACT_TABS_PAYLOAD_KIND = 'artifact-tabs' as const
export const ARTIFACT_TABS_VERSION = 1 as const

export type ArtifactTabsPersistedPayload = {
  kind: typeof ARTIFACT_TABS_PAYLOAD_KIND
  version: typeof ARTIFACT_TABS_VERSION
  activeTabId: string
  tabs: ArtifactTab[]
}

function randomTabId(): string {
  return `tab_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`
}

/** Stable identity for "same resource" when merging stream/tool updates into tabs. */
export function artifactTabIdentityKey(p: WorkspaceArtifactPayload): string {
  switch (p.kind) {
    case 'document':
      return 'document:conversation-canvas'
    case 'workspace-file':
      return `workspace-file:${p.relativePath}`
    case 'tabular':
      return `tabular:${p.title ?? 'data'}`
    case 'tabular-multi':
      return `tabular-multi:${p.title ?? 'multi'}`
    case 'visual':
      return `visual:${p.title ?? 'image'}`
    case 'app-preview':
      return 'app-preview'
    default:
      return p.kind
  }
}

export function findTabIndexByPayload(
  tabs: ArtifactTab[],
  payload: WorkspaceArtifactPayload,
): number {
  const key = artifactTabIdentityKey(payload)
  return tabs.findIndex(
    (t) => artifactTabIdentityKey(t.payload) === key,
  )
}

export function getActiveArtifactPayload(
  thread: Pick<
    ChatThreadState,
    'artifactTabs' | 'activeArtifactTabId'
  >,
): WorkspaceArtifactPayload | null {
  const { artifactTabs, activeArtifactTabId } = thread
  if (!activeArtifactTabId || artifactTabs.length === 0) return null
  const tab = artifactTabs.find((t) => t.id === activeArtifactTabId)
  return tab?.payload ?? null
}

export function hasArtifactTabs(thread: Pick<ChatThreadState, 'artifactTabs'>): boolean {
  return thread.artifactTabs.length > 0
}

export function artifactTabLabel(tab: ArtifactTab): string {
  const p = tab.payload
  if (p.kind === 'document') return p.title?.trim() || 'Document'
  if (p.kind === 'workspace-file')
    return (
      p.title?.trim() ||
      p.relativePath.replace(/^.*\//, '') ||
      p.relativePath
    )
  if (p.kind === 'tabular' || p.kind === 'tabular-multi')
    return p.title?.trim() || 'Data'
  if (p.kind === 'visual') return p.title?.trim() || 'Visual'
  if (p.kind === 'app-preview') return 'App preview'
  return 'Canvas'
}

/**
 * Hydrate tabs + active id from disk/Rust `artifact_payload` (single payload or wrapper).
 */
export function normalizeArtifactStateFromPersisted(
  raw: unknown | null | undefined,
): Pick<ChatThreadState, 'artifactTabs' | 'activeArtifactTabId'> {
  if (raw == null || typeof raw !== 'object') {
    return { artifactTabs: [], activeArtifactTabId: null }
  }
  const v = raw as Record<string, unknown>
  if (v.kind === ARTIFACT_TABS_PAYLOAD_KIND) {
    const tabsRaw = v.tabs
    const activeTabId =
      typeof v.activeTabId === 'string' ? v.activeTabId : null
    if (!Array.isArray(tabsRaw) || tabsRaw.length === 0) {
      return { artifactTabs: [], activeArtifactTabId: null }
    }
    const tabs: ArtifactTab[] = []
    for (const item of tabsRaw) {
      if (!item || typeof item !== 'object') continue
      const o = item as Record<string, unknown>
      const id = typeof o.id === 'string' ? o.id : randomTabId()
      const payload = o.payload as WorkspaceArtifactPayload | undefined
      if (payload && typeof payload === 'object' && 'kind' in payload) {
        tabs.push({ id, payload })
      }
    }
    if (tabs.length === 0) {
      return { artifactTabs: [], activeArtifactTabId: null }
    }
    const validActive =
      activeTabId && tabs.some((t) => t.id === activeTabId)
        ? activeTabId
        : tabs[0]!.id
    return { artifactTabs: tabs, activeArtifactTabId: validActive }
  }

  const payload = raw as WorkspaceArtifactPayload
  if (payload && typeof payload === 'object' && 'kind' in payload) {
    const id = randomTabId()
    return {
      artifactTabs: [{ id, payload }],
      activeArtifactTabId: id,
    }
  }

  return { artifactTabs: [], activeArtifactTabId: null }
}

/** Payload written to `conversation_save` — single canvas or multi-tab wrapper. */
export function serializeArtifactForPersistence(
  thread: Pick<ChatThreadState, 'artifactTabs' | 'activeArtifactTabId'>,
): WorkspaceArtifactPayload | ArtifactTabsPersistedPayload | null {
  const { artifactTabs } = thread
  if (artifactTabs.length === 0) return null

  if (artifactTabs.length === 1) {
    return artifactTabs[0]!.payload
  }

  const active =
    thread.activeArtifactTabId &&
    artifactTabs.some((t) => t.id === thread.activeArtifactTabId)
      ? thread.activeArtifactTabId!
      : artifactTabs[0]!.id

  return {
    kind: ARTIFACT_TABS_PAYLOAD_KIND,
    version: ARTIFACT_TABS_VERSION,
    activeTabId: active,
    tabs: artifactTabs,
  }
}

export function mergeStreamArtifactIntoTabs(
  prev: Pick<ChatThreadState, 'artifactTabs' | 'activeArtifactTabId'>,
  payload: WorkspaceArtifactPayload,
): Pick<ChatThreadState, 'artifactTabs' | 'activeArtifactTabId'> {
  const tabs = [...prev.artifactTabs]
  const idx = findTabIndexByPayload(tabs, payload)
  let nextRev = 1
  if (payload.kind === 'document' && payload.canvasRevision == null) {
    const prevRev =
      idx >= 0 && tabs[idx]?.payload.kind === 'document'
        ? (tabs[idx]!.payload.canvasRevision ?? 0)
        : 0
    nextRev = prevRev + 1
    const merged: WorkspaceArtifactPayload = {
      ...payload,
      canvasRevision: nextRev,
    }
    if (idx >= 0) {
      tabs[idx] = { ...tabs[idx]!, payload: merged }
      return { artifactTabs: tabs, activeArtifactTabId: tabs[idx]!.id }
    }
    const id = randomTabId()
    tabs.push({ id, payload: merged })
    return { artifactTabs: tabs, activeArtifactTabId: id }
  }
  if (payload.kind === 'workspace-file' && payload.canvasRevision == null) {
    const samePath =
      idx >= 0 &&
      tabs[idx]?.payload.kind === 'workspace-file' &&
      tabs[idx]!.payload.relativePath === payload.relativePath
    const prevRev = samePath ? (tabs[idx]!.payload.canvasRevision ?? 0) : 0
    const resolvedRev = samePath ? prevRev + 1 : 1
    const merged: WorkspaceArtifactPayload = {
      ...payload,
      canvasRevision: resolvedRev,
    }
    if (idx >= 0) {
      tabs[idx] = { ...tabs[idx]!, payload: merged }
      return { artifactTabs: tabs, activeArtifactTabId: tabs[idx]!.id }
    }
    const id = randomTabId()
    tabs.push({ id, payload: merged })
    return { artifactTabs: tabs, activeArtifactTabId: id }
  }

  if (idx >= 0) {
    tabs[idx] = { ...tabs[idx]!, payload }
    return { artifactTabs: tabs, activeArtifactTabId: tabs[idx]!.id }
  }
  const id = randomTabId()
  tabs.push({ id, payload })
  return { artifactTabs: tabs, activeArtifactTabId: id }
}

export function patchActiveTabPayload(
  thread: ChatThreadState,
  fn: (p: WorkspaceArtifactPayload) => WorkspaceArtifactPayload | null,
): ChatThreadState {
  const activeId = thread.activeArtifactTabId
  if (!activeId) return thread
  const idx = thread.artifactTabs.findIndex((t) => t.id === activeId)
  if (idx < 0) return thread
  const nextPayload = fn(thread.artifactTabs[idx]!.payload)
  if (nextPayload == null) return thread
  const artifactTabs = [...thread.artifactTabs]
  artifactTabs[idx] = { ...artifactTabs[idx]!, payload: nextPayload }
  return { ...thread, artifactTabs }
}

/**
 * Normalize hydrated thread state (supports legacy `artifactOpen` + `artifactPayload`).
 */
export function normalizeChatThreadState(
  s: ChatThreadState &
    Partial<{ artifactOpen?: boolean; artifactPayload?: unknown }>,
): ChatThreadState {
  const legacy = s as ChatThreadState & {
    artifactOpen?: boolean
    artifactPayload?: unknown
  }
  const {
    artifactOpen: _legacyOpen,
    artifactPayload: _legacyPayload,
    ...rest
  } = legacy

  if (Array.isArray(rest.artifactTabs)) {
    return {
      ...DEFAULT_CHAT_THREAD,
      ...rest,
      artifactPanelCollapsed: rest.artifactPanelCollapsed ?? false,
      artifactTabs: rest.artifactTabs,
      activeArtifactTabId: rest.activeArtifactTabId ?? null,
    }
  }
  const fromPayload = normalizeArtifactStateFromPersisted(
    legacy.artifactPayload ?? null,
  )
  let artifactPanelCollapsed = rest.artifactPanelCollapsed
  if (artifactPanelCollapsed === undefined) {
    if (fromPayload.artifactTabs.length === 0) {
      artifactPanelCollapsed = false
    } else {
      artifactPanelCollapsed = !(_legacyOpen ?? false)
    }
  }
  return {
    ...DEFAULT_CHAT_THREAD,
    ...rest,
    artifactPanelCollapsed,
    artifactTabs: fromPayload.artifactTabs,
    activeArtifactTabId: fromPayload.activeArtifactTabId,
  }
}

/** Composite key for live canvas getters (session + focused tab). */
export function canvasLiveScopeKey(
  sessionKey: string,
  tabId: string | null,
): string {
  if (!tabId) return sessionKey
  return `${sessionKey}::${tabId}`
}

export function removeArtifactTab(
  thread: ChatThreadState,
  tabId: string,
): ChatThreadState {
  const prevIdx = thread.artifactTabs.findIndex((t) => t.id === tabId)
  const artifactTabs = thread.artifactTabs.filter((t) => t.id !== tabId)
  let activeArtifactTabId = thread.activeArtifactTabId
  if (activeArtifactTabId === tabId) {
    if (artifactTabs.length === 0) {
      activeArtifactTabId = null
    } else {
      const pick = Math.min(prevIdx, artifactTabs.length - 1)
      activeArtifactTabId = artifactTabs[Math.max(0, pick)]!.id
    }
  }
  if (
    artifactTabs.length > 0 &&
    activeArtifactTabId &&
    !artifactTabs.some((t) => t.id === activeArtifactTabId)
  ) {
    activeArtifactTabId = artifactTabs[0]!.id
  }
  return { ...thread, artifactTabs, activeArtifactTabId }
}
