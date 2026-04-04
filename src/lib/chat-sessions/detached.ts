/** Session key workspace segment for /chat/new (no folder until user moves the thread). */
export const DETACHED_WORKSPACE_SESSION_ID = '__braian_detached__'

export function isDetachedWorkspaceSessionId(workspaceId: string): boolean {
  return workspaceId === DETACHED_WORKSPACE_SESSION_ID
}
