import {
  WORKSPACE_PREFERENCES_RELATIVE_PATH,
} from '@/lib/memory/constants'
import { isNonWorkspaceScopedSessionId } from '@/lib/chat-sessions/detached'
import { isTauri } from '@/lib/tauri-env'
import { workspaceReadTextFile } from '@/lib/workspace-api'
import { z } from 'zod'

const PREFS_MAX_BYTES = 64 * 1024

const workspacePreferencesSchema = z
  .object({
    injectLegacyMemoryMd: z.boolean().optional(),
  })
  .passthrough()

export type WorkspacePreferencesFlags = {
  /** When false, `.braian/MEMORY.md` is not injected into the model (structured memory remains). Default true. */
  injectLegacyMemoryMd: boolean
}

/** Parse JSON body for `injectLegacyMemoryMd` (non-JSON or missing → default true). */
export function parseWorkspacePreferencesFlagsFromJsonText(
  raw: string,
): WorkspacePreferencesFlags {
  const t = raw.trim()
  if (!t) return { injectLegacyMemoryMd: true }
  try {
    const parsed = JSON.parse(t) as unknown
    const r = workspacePreferencesSchema.safeParse(parsed)
    if (r.success && r.data.injectLegacyMemoryMd === false) {
      return { injectLegacyMemoryMd: false }
    }
  } catch {
    /* plain text or invalid JSON */
  }
  return { injectLegacyMemoryMd: true }
}

/**
 * Single read of workspace preferences JSON: formatted system block + injection flags.
 */
export async function getWorkspacePreferencesState(
  workspaceId: string,
): Promise<{
  preferencesBlock: string
  injectLegacyMemoryMd: boolean
}> {
  if (isNonWorkspaceScopedSessionId(workspaceId) || !isTauri()) {
    return { preferencesBlock: '', injectLegacyMemoryMd: true }
  }
  try {
    const { text, truncated } = await workspaceReadTextFile(
      workspaceId,
      WORKSPACE_PREFERENCES_RELATIVE_PATH,
      PREFS_MAX_BYTES,
    )
    const t = text.trim()
    if (!t) {
      return { preferencesBlock: '', injectLegacyMemoryMd: true }
    }
    const { injectLegacyMemoryMd } = parseWorkspacePreferencesFlagsFromJsonText(t)
    const note = truncated
      ? '\n[Note: file was truncated for context size.]\n'
      : ''
    const preferencesBlock = `Workspace preferences (from \`${WORKSPACE_PREFERENCES_RELATIVE_PATH}\`):${note}\n\n${t}`
    return { preferencesBlock, injectLegacyMemoryMd }
  } catch {
    return { preferencesBlock: '', injectLegacyMemoryMd: true }
  }
}
