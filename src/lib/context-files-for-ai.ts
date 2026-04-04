import type { ContextFileForModel } from '@/lib/ai/types'
import type { ContextFileEntry } from '@/lib/chat-sessions/types'
import { workspaceReadTextFile } from '@/lib/workspace-api'

/** Cap total injected characters so prompts stay bounded. */
const MAX_TOTAL_CHARS = 350_000

export async function loadContextFilesForModel(
  workspaceId: string,
  entries: ContextFileEntry[],
): Promise<ContextFileForModel[]> {
  const out: ContextFileForModel[] = []
  let total = 0
  for (const e of entries) {
    if (total >= MAX_TOTAL_CHARS) break
    try {
      const { text, truncated } = await workspaceReadTextFile(
        workspaceId,
        e.relativePath,
        null,
      )
      const room = MAX_TOTAL_CHARS - total
      let t = text
      let fileTruncated = truncated
      if (t.length > room) {
        t = t.slice(0, room)
        fileTruncated = true
      }
      total += t.length
      out.push({
        relativePath: e.relativePath,
        ...(e.displayName != null && e.displayName !== ''
          ? { displayName: e.displayName }
          : {}),
        text: t,
        fileTruncated,
      })
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : typeof err === 'string' ? err : 'Unknown error'
      out.push({
        relativePath: e.relativePath,
        ...(e.displayName != null && e.displayName !== ''
          ? { displayName: e.displayName }
          : {}),
        text: `[Could not read file: ${msg}]`,
        fileTruncated: false,
      })
    }
  }
  return out
}
