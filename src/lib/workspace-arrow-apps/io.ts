import {
  parseArrowAppsIndexJson,
  stringifyArrowAppsIndex,
  normalizeArrowAppId,
  type ArrowAppsIndexFile,
} from '@/lib/workspace-arrow-apps/index-file'
import { isCloudEnabled } from '@/lib/cloud/auth-state'
import {
  bundleToArrowAppsIndex,
  fetchArrowWorkspaceBundle,
  isArrowCloudSyncWorkspace,
  pushArrowWorkspaceMeta,
} from '@/lib/cloud/arrow-apps-sync'
import { isTauri } from '@/lib/tauri-env'
import {
  workspaceReadTextFile,
  workspaceWriteTextFile,
} from '@/lib/workspace-api'

const INDEX = '.braian/arrow-apps.json'
const READ_MAX = 256 * 1024

const emptyIndex = (): ArrowAppsIndexFile => ({
  schemaVersion: 1,
  generatedAtMs: Date.now(),
  activeAppId: null,
  apps: [],
})

export async function loadArrowAppsIndex(
  workspaceId: string,
): Promise<ArrowAppsIndexFile> {
  if (!isTauri()) {
    if (!isCloudEnabled() || !isArrowCloudSyncWorkspace(workspaceId)) {
      return emptyIndex()
    }
    const bundle = await fetchArrowWorkspaceBundle(workspaceId)
    return bundleToArrowAppsIndex(bundle)
  }
  try {
    const { text } = await workspaceReadTextFile(
      workspaceId,
      INDEX,
      READ_MAX,
    )
    return parseArrowAppsIndexJson(text)
  } catch {
    return emptyIndex()
  }
}

export async function saveArrowAppsIndex(
  workspaceId: string,
  index: ArrowAppsIndexFile,
): Promise<void> {
  if (!isTauri()) {
    throw new Error('Arrow index files are only persisted on disk in the desktop app.')
  }
  await workspaceWriteTextFile(
    workspaceId,
    INDEX,
    stringifyArrowAppsIndex(index),
  )
  if (isCloudEnabled() && isArrowCloudSyncWorkspace(workspaceId)) {
    void pushArrowWorkspaceMeta({
      workspaceClientId: workspaceId,
      activeAppId: index.activeAppId,
    })
  }
}

/** Persists `activeAppId` when the app exists in the index. */
export async function persistActiveArrowAppId(
  workspaceId: string,
  rawAppId: string,
): Promise<{ ok: true; appId: string } | { ok: false; error: string }> {
  try {
    const appId = normalizeArrowAppId(rawAppId.replace(/^\//, ''))
    const index = await loadArrowAppsIndex(workspaceId)
    if (!index.apps.some((a) => a.id === appId)) {
      return {
        ok: false,
        error: `Unknown Arrow app id "${appId}".`,
      }
    }
    if (!isTauri()) {
      if (!isCloudEnabled() || !isArrowCloudSyncWorkspace(workspaceId)) {
        return { ok: false, error: 'Cloud sign-in required to change the active Arrow app on web.' }
      }
      await pushArrowWorkspaceMeta({
        workspaceClientId: workspaceId,
        activeAppId: appId,
      })
      return { ok: true, appId }
    }
    await saveArrowAppsIndex(workspaceId, {
      ...index,
      activeAppId: appId,
      generatedAtMs: Date.now(),
    })
    return { ok: true, appId }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}
