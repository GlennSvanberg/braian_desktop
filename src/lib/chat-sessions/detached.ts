/** Session key workspace segment for /chat/new (no folder until user moves the thread). */
export const DETACHED_WORKSPACE_SESSION_ID = '__braian_detached__'

/** Synthetic workspace id for sidebar → You (global profile chat, localStorage). */
export const USER_PROFILE_WORKSPACE_SESSION_ID = '__braian_user_profile__'

export function isDetachedWorkspaceSessionId(workspaceId: string): boolean {
  return workspaceId === DETACHED_WORKSPACE_SESSION_ID
}

export function isUserProfileSessionId(workspaceId: string): boolean {
  return workspaceId === USER_PROFILE_WORKSPACE_SESSION_ID
}

/** No workspace folder on disk — file tools and MEMORY.md do not apply. */
export function isNonWorkspaceScopedSessionId(workspaceId: string): boolean {
  return (
    isDetachedWorkspaceSessionId(workspaceId) ||
    isUserProfileSessionId(workspaceId)
  )
}
