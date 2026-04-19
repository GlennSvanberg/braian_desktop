/**
 * Synthetic workspace id used for cloud-only conversations in the sidebar.
 *
 * V1 has no cloud workspace concept; every signed-in user has a single bucket
 * named "Cloud" that mirrors their cross-device thread list. This id is used
 * as a key in `conversationsByWorkspace` so existing sidebar rendering code
 * can group cloud rows without any new branches.
 */
export const CLOUD_WORKSPACE_SESSION_ID = '__braian_cloud__'

export function isCloudWorkspaceSessionId(workspaceId: string): boolean {
  return workspaceId === CLOUD_WORKSPACE_SESSION_ID
}

/**
 * Virtual workspace shown in the sidebar when running on the web (or any non-
 * Tauri host) so users see their cloud-synced threads instead of mock data.
 * Has no real `rootPath` since the web client never touches the local FS.
 */
export function cloudVirtualWorkspaceDto() {
  return {
    id: CLOUD_WORKSPACE_SESSION_ID,
    name: 'Cloud chats',
    rootPath: '',
    createdAtMs: 0,
    lastUsedAtMs: Date.now(),
  }
}
