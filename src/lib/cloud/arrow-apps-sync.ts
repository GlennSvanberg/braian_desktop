import { api } from '../../../convex/_generated/api'
import {
  isNonWorkspaceScopedSessionId,
  isUserProfileSessionId,
} from '@/lib/chat-sessions/detached'
import {
  arrowAppDirRelative,
  arrowAppMainCssRelative,
  arrowAppMainTsRelative,
  arrowAppManifestRelative,
} from '@/lib/workspace-arrow-apps/constants'
import type { ArrowAppIndexEntry, ArrowAppsIndexFile } from '@/lib/workspace-arrow-apps/index-file'
import {
  workspaceDeleteEntry,
  workspaceReadTextFile,
  workspaceWriteTextFile,
} from '@/lib/workspace-api'
import { isTauri } from '@/lib/tauri-env'
import { emitWorkspaceDurableActivity } from '@/lib/workspace/workspace-activity'

import { isCloudEnabled } from './auth-state'
import { getConvexClient } from './convex-client'

/** Stay under Convex single-document limits for `mainTs`. */
export const ARROW_CLOUD_MAX_MAIN_TS_CHARS = 900_000
export const ARROW_CLOUD_MAX_CSS_CHARS = 200_000
export const ARROW_CLOUD_MAX_MANIFEST_CHARS = 60_000

const arrowMetaCursorKey = (workspaceClientId: string) =>
  `braian.cloud.arrowMetaCursor.${workspaceClientId}`

function readArrowMetaCursor(workspaceClientId: string): number {
  if (typeof localStorage === 'undefined') return 0
  try {
    const raw = localStorage.getItem(arrowMetaCursorKey(workspaceClientId))
    if (!raw) return 0
    const n = Number(raw)
    return Number.isFinite(n) ? n : 0
  } catch {
    return 0
  }
}

function writeArrowMetaCursor(workspaceClientId: string, updatedAtMs: number): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(arrowMetaCursorKey(workspaceClientId), String(updatedAtMs))
  } catch {
    /* ignore */
  }
}

export function isArrowCloudSyncWorkspace(workspaceId: string | null | undefined): boolean {
  if (!workspaceId) return false
  if (isNonWorkspaceScopedSessionId(workspaceId)) return false
  if (isUserProfileSessionId(workspaceId)) return false
  return true
}

function clampStr(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max)
}

export type ArrowWorkspaceBundle = {
  meta: { activeAppId: string | null; updatedAtMs: number }
  apps: Array<{
    appId: string
    title: string
    mainTs: string
    mainCss: string
    manifestJson: string
    updatedAtMs: number
  }>
  deletedApps: Array<{ appId: string; updatedAtMs: number }>
}

export function bundleToArrowAppsIndex(bundle: ArrowWorkspaceBundle | null): ArrowAppsIndexFile {
  if (!bundle) {
    return {
      schemaVersion: 1,
      generatedAtMs: Date.now(),
      activeAppId: null,
      apps: [],
    }
  }
  const apps = bundle.apps.map((a) => ({
    id: a.appId,
    title: a.title,
    updatedAtMs: a.updatedAtMs,
  }))
  const stamp = Math.max(
    bundle.meta.updatedAtMs,
    ...apps.map((a) => a.updatedAtMs),
    Date.now(),
  )
  return {
    schemaVersion: 1,
    generatedAtMs: stamp,
    activeAppId: bundle.meta.activeAppId,
    apps,
  }
}

export async function fetchArrowWorkspaceBundle(
  workspaceClientId: string,
): Promise<ArrowWorkspaceBundle | null> {
  if (!isCloudEnabled() || !isArrowCloudSyncWorkspace(workspaceClientId)) return null
  const client = getConvexClient()
  if (!client) return null
  try {
    return await client.query(api.arrowApps.workspaceBundle, { workspaceClientId })
  } catch (err) {
    console.error('[braian/cloud] fetchArrowWorkspaceBundle failed', err)
    return null
  }
}

export async function pushArrowAppUpsert(input: {
  workspaceClientId: string
  appId: string
  title: string
  mainTs: string
  mainCss?: string
  manifestJson?: string
}): Promise<void> {
  if (!isCloudEnabled() || !isArrowCloudSyncWorkspace(input.workspaceClientId)) return
  const client = getConvexClient()
  if (!client) return
  const now = Date.now()
  const mainTs = clampStr(input.mainTs, ARROW_CLOUD_MAX_MAIN_TS_CHARS)
  const mainCss =
    input.mainCss !== undefined
      ? clampStr(input.mainCss, ARROW_CLOUD_MAX_CSS_CHARS)
      : undefined
  const manifestJson =
    input.manifestJson !== undefined
      ? clampStr(input.manifestJson, ARROW_CLOUD_MAX_MANIFEST_CHARS)
      : undefined
  try {
    await client.mutation(api.arrowApps.upsertApp, {
      workspaceClientId: input.workspaceClientId,
      appId: input.appId,
      title: input.title,
      mainTs,
      mainCss,
      manifestJson,
      updatedAtMs: now,
    })
  } catch (err) {
    console.error('[braian/cloud] pushArrowAppUpsert failed', err)
  }
}

export async function pushArrowWorkspaceMeta(input: {
  workspaceClientId: string
  activeAppId: string | null
}): Promise<void> {
  if (!isCloudEnabled() || !isArrowCloudSyncWorkspace(input.workspaceClientId)) return
  const client = getConvexClient()
  if (!client) return
  const now = Date.now()
  try {
    await client.mutation(api.arrowApps.setWorkspaceMeta, {
      workspaceClientId: input.workspaceClientId,
      activeAppId: input.activeAppId,
      updatedAtMs: now,
    })
    writeArrowMetaCursor(input.workspaceClientId, now)
  } catch (err) {
    console.error('[braian/cloud] pushArrowWorkspaceMeta failed', err)
  }
}

export async function pushArrowSoftDeleteApp(input: {
  workspaceClientId: string
  appId: string
}): Promise<void> {
  if (!isCloudEnabled() || !isArrowCloudSyncWorkspace(input.workspaceClientId)) return
  const client = getConvexClient()
  if (!client) return
  try {
    await client.mutation(api.arrowApps.softDeleteApp, {
      workspaceClientId: input.workspaceClientId,
      appId: input.appId,
      updatedAtMs: Date.now(),
    })
  } catch (err) {
    console.error('[braian/cloud] pushArrowSoftDeleteApp failed', err)
  }
}

/**
 * Push the full Arrow workspace from local disk to Convex (desktop backfill).
 */
export async function pushFullArrowWorkspaceFromDisk(workspaceClientId: string): Promise<void> {
  if (!isTauri() || !isCloudEnabled() || !isArrowCloudSyncWorkspace(workspaceClientId)) return
  const { loadArrowAppsIndex } = await import('@/lib/workspace-arrow-apps/io')
  const index = await loadArrowAppsIndex(workspaceClientId)
  for (const entry of index.apps) {
    try {
      const mainTs = await workspaceReadTextFile(
        workspaceClientId,
        arrowAppMainTsRelative(entry.id),
        2 * 1024 * 1024,
      )
      let mainCss: string | undefined
      try {
        const css = await workspaceReadTextFile(
          workspaceClientId,
          arrowAppMainCssRelative(entry.id),
          256 * 1024,
        )
        if (css.text.trim()) mainCss = css.text
      } catch {
        mainCss = undefined
      }
      let manifestJson: string | undefined
      try {
        const m = await workspaceReadTextFile(
          workspaceClientId,
          arrowAppManifestRelative(entry.id),
          64 * 1024,
        )
        manifestJson = m.text
      } catch {
        manifestJson = undefined
      }
      await pushArrowAppUpsert({
        workspaceClientId,
        appId: entry.id,
        title: entry.title,
        mainTs: mainTs.text,
        mainCss,
        manifestJson,
      })
    } catch (err) {
      console.error('[braian/cloud] pushFullArrowWorkspaceFromDisk app failed', entry.id, err)
    }
  }
  await pushArrowWorkspaceMeta({
    workspaceClientId,
    activeAppId: index.activeAppId,
  })
}

/**
 * Merge remote Convex Arrow data into the local workspace folder (Tauri).
 * Returns true if any file was written or deleted.
 */
export async function pullArrowAppsToDisk(workspaceClientId: string): Promise<boolean> {
  if (!isTauri() || !isCloudEnabled() || !isArrowCloudSyncWorkspace(workspaceClientId)) {
    return false
  }
  const bundle = await fetchArrowWorkspaceBundle(workspaceClientId)
  if (!bundle) return false

  const { loadArrowAppsIndex, saveArrowAppsIndex } = await import('@/lib/workspace-arrow-apps/io')
  const localIndex = await loadArrowAppsIndex(workspaceClientId)
  const localById = new Map(localIndex.apps.map((a) => [a.id, a]))
  const remoteActive = new Map(bundle.apps.map((a) => [a.appId, a]))
  const deletedMap = new Map(
    (bundle.deletedApps ?? []).map((d) => [d.appId, d.updatedAtMs]),
  )

  let touched = false
  const nextEntries: ArrowAppIndexEntry[] = []

  for (const remote of bundle.apps) {
    const local = localById.get(remote.appId)
    const remoteNewer = !local || remote.updatedAtMs > local.updatedAtMs
    if (remoteNewer && remote.mainTs.length > 0) {
      await workspaceWriteTextFile(
        workspaceClientId,
        arrowAppMainTsRelative(remote.appId),
        remote.mainTs,
      )
      if (remote.mainCss.trim()) {
        await workspaceWriteTextFile(
          workspaceClientId,
          arrowAppMainCssRelative(remote.appId),
          remote.mainCss,
        )
      } else {
        try {
          await workspaceDeleteEntry(
            workspaceClientId,
            arrowAppMainCssRelative(remote.appId),
          )
        } catch {
          /* optional */
        }
      }
      if (remote.manifestJson.trim()) {
        await workspaceWriteTextFile(
          workspaceClientId,
          arrowAppManifestRelative(remote.appId),
          remote.manifestJson,
        )
      }
      touched = true
    }
    nextEntries.push({
      id: remote.appId,
      title: remote.title,
      updatedAtMs: Math.max(remote.updatedAtMs, local?.updatedAtMs ?? 0),
    })
  }

  for (const local of localIndex.apps) {
    if (remoteActive.has(local.id)) continue
    const tomb = deletedMap.get(local.id)
    if (tomb !== undefined && tomb >= local.updatedAtMs) {
      try {
        await workspaceDeleteEntry(workspaceClientId, arrowAppDirRelative(local.id))
      } catch {
        /* */
      }
      touched = true
      continue
    }
    if (tomb === undefined) {
      nextEntries.push(local)
    }
  }

  const metaCursor = readArrowMetaCursor(workspaceClientId)
  let activeAppId = localIndex.activeAppId
  if (bundle.meta.updatedAtMs > metaCursor) {
    const pick = bundle.meta.activeAppId
    if (pick && nextEntries.some((a) => a.id === pick)) {
      activeAppId = pick
    } else if (!pick) {
      activeAppId = null
    }
    writeArrowMetaCursor(workspaceClientId, bundle.meta.updatedAtMs)
  } else if (activeAppId && !nextEntries.some((a) => a.id === activeAppId)) {
    activeAppId = nextEntries[0]?.id ?? null
  }

  const merged: ArrowAppsIndexFile = {
    schemaVersion: 1,
    generatedAtMs: Date.now(),
    activeAppId,
    apps: nextEntries.sort((a, b) => a.id.localeCompare(b.id)),
  }

  const indexChanged =
    touched ||
    merged.activeAppId !== localIndex.activeAppId ||
    merged.apps.length !== localIndex.apps.length ||
    merged.apps.some((a) => {
      const o = localIndex.apps.find((x) => x.id === a.id)
      return !o || o.updatedAtMs !== a.updatedAtMs || o.title !== a.title
    })

  if (indexChanged) {
    await saveArrowAppsIndex(workspaceClientId, merged)
    touched = true
  }

  if (touched) {
    emitWorkspaceDurableActivity(workspaceClientId)
  }
  return touched
}
