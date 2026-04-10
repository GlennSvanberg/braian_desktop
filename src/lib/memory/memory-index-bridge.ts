import { invoke } from '@tauri-apps/api/core'

import type { SemanticMemoryRecordV1 } from '@/lib/memory/semantic-record'
import { isTauri } from '@/lib/tauri-env'

/** Upsert derived SQLite row after a canonical JSON file write. */
export async function maybeNotifyMemoryIndexUpsert(
  workspaceId: string,
  record: SemanticMemoryRecordV1,
  relativePath: string,
): Promise<void> {
  if (!isTauri()) return
  try {
    await invoke('memory_index_upsert', {
      workspaceId,
      entryId: record.id,
      kind: record.kind,
      summary: record.summary,
      status: record.status,
      relativePath: relativePath.replace(/\\/g, '/'),
      updatedAtMs: Date.parse(record.updatedAt) || Date.now(),
    })
  } catch {
    /* ignore if command missing or DB unavailable */
  }
}

export async function memoryIndexRebuildWorkspace(
  workspaceId: string,
): Promise<void> {
  if (!isTauri()) return
  await invoke('memory_index_rebuild_workspace', { workspaceId })
}
