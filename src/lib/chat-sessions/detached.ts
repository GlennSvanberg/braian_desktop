/** App-managed simple chats root (SQLite + `personal-chats/` under app data). */
export const PERSONAL_WORKSPACE_SESSION_ID = '__braian_personal__'

/** Synthetic workspace id for sidebar → You (global profile chat, localStorage). */
export const USER_PROFILE_WORKSPACE_SESSION_ID = '__braian_user_profile__'

export function isPersonalWorkspaceSessionId(workspaceId: string): boolean {
  return workspaceId === PERSONAL_WORKSPACE_SESSION_ID
}

export function isUserProfileSessionId(workspaceId: string): boolean {
  return workspaceId === USER_PROFILE_WORKSPACE_SESSION_ID
}

/**
 * Chats without a user project folder for tooling: simple chats bucket and profile coach.
 * File tools, @-mentions of project files, and workspace git/memory hooks should not apply.
 */
export function isNonWorkspaceScopedSessionId(workspaceId: string): boolean {
  return (
    isPersonalWorkspaceSessionId(workspaceId) ||
    isUserProfileSessionId(workspaceId)
  )
}
