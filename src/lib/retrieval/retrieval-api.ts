import { invoke } from '@tauri-apps/api/core'

export type RetrievalChunkInput = {
  chunkOrdinal: number
  sourceKind: string
  sourceRef: string
  bodyText: string
  contentHash: string
  embeddingModelId: string
  embeddingDim: number
  embedding: number[]
}

export async function retrievalReplaceSourceChunks(input: {
  workspaceId: string
  sourceId: string
  chunks: RetrievalChunkInput[]
}): Promise<void> {
  await invoke('retrieval_replace_source_chunks', {
    workspaceId: input.workspaceId,
    sourceId: input.sourceId,
    chunks: input.chunks.map((c) => ({
      chunkOrdinal: c.chunkOrdinal,
      sourceKind: c.sourceKind,
      sourceRef: c.sourceRef,
      bodyText: c.bodyText,
      contentHash: c.contentHash,
      embeddingModelId: c.embeddingModelId,
      embeddingDim: c.embeddingDim,
      embedding: c.embedding,
    })),
  })
}

export async function retrievalDeleteSource(
  workspaceId: string,
  sourceId: string,
): Promise<void> {
  await invoke('retrieval_delete_source', { workspaceId, sourceId })
}

export async function retrievalClearWorkspace(workspaceId: string): Promise<void> {
  await invoke('retrieval_clear_workspace', { workspaceId })
}

export type RetrievalSearchHit = {
  score: number
  sourceId: string
  chunkOrdinal: number
  sourceKind: string
  sourceRef: string
  bodyText: string
  embeddingModelId: string
}

export async function retrievalSearch(input: {
  workspaceId: string
  queryEmbedding: number[]
  embeddingModelId: string
  topK: number
  sourceKinds?: string[]
}): Promise<RetrievalSearchHit[]> {
  return await invoke<RetrievalSearchHit[]>('retrieval_search', {
    input: {
      workspaceId: input.workspaceId,
      queryEmbedding: input.queryEmbedding,
      embeddingModelId: input.embeddingModelId,
      topK: input.topK,
      sourceKinds: input.sourceKinds,
    },
  })
}

export async function retrievalIndexStatus(workspaceId: string): Promise<{
  chunkCount: number
  sourceCount: number
}> {
  return await invoke('retrieval_index_status', { workspaceId })
}

export async function retrievalPutSourceState(input: {
  workspaceId: string
  entries: Array<{
    sourceId: string
    mtimeMs?: number | null
    contentHash: string
  }>
}): Promise<void> {
  await invoke('retrieval_put_source_state', {
    workspaceId: input.workspaceId,
    entries: input.entries,
  })
}

export async function retrievalGetSourceState(
  workspaceId: string,
  sourceId: string,
): Promise<{ mtimeMs: number | null; contentHash: string } | null> {
  const raw = await invoke<{
    mtimeMs: number | null
    contentHash: string
  } | null>('retrieval_get_source_state', { workspaceId, sourceId })
  if (!raw) return null
  return { mtimeMs: raw.mtimeMs, contentHash: raw.contentHash }
}
