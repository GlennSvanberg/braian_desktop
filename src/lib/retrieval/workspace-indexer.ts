import type { AiSettingsDto } from '@/lib/ai-settings-api'
import { aiSettingsGet } from '@/lib/ai-settings-api'
import {
  canEmbed,
  embedTexts,
  embeddingModelIdForStorage,
} from '@/lib/ai/embedding-client'
import {
  conversationList,
  workspaceListAllFiles,
  workspaceReadTextFile,
} from '@/lib/workspace-api'
import { isTauri } from '@/lib/tauri-env'
import { chunkPlainText } from '@/lib/retrieval/chunk-text'
import { chunkMessagesByTokens } from '@/lib/retrieval/message-chunks'
import {
  formatConversationChunkHeader,
  formatFileChunkHeader,
  formatMemoryChunkHeader,
} from '@/lib/retrieval/retrieval-format'
import { shouldSkipSecretsPath, shouldSkipWalkDirName } from '@/lib/retrieval/path-rules'
import { sha256Hex } from '@/lib/retrieval/retrieval-hash'
import {
  retrievalClearWorkspace,
  retrievalGetSourceState,
  retrievalPutSourceState,
  retrievalReplaceSourceChunks,
  type RetrievalChunkInput,
} from '@/lib/retrieval/retrieval-api'
import {
  listSemanticMemoryRecordPaths,
  readSemanticMemoryRecord,
} from '@/lib/memory/semantic-store'

const READ_MAX = 512 * 1024
const CHUNK_MAX_TOKENS = 720
const CHUNK_OVERLAP = 0.15
const EMBED_BATCH = 24

function posix(p: string): string {
  return p.replace(/\\/g, '/')
}

function walkRelativeParts(parts: string[]): boolean {
  for (const p of parts) {
    if (shouldSkipWalkDirName(p)) return true
  }
  return false
}

/** After conversation or memory save — debounced incremental reindex. */
const debounceMs = 2000
const scheduleTimers = new Map<string, ReturnType<typeof setTimeout>>()

export function scheduleWorkspaceSemanticIndex(
  workspaceId: string,
  opts?: { conversationId?: string; memoryRelativePath?: string },
): void {
  if (!isTauri()) return
  const key = `${workspaceId}:${opts?.conversationId ?? ''}:${opts?.memoryRelativePath ?? ''}`
  const prev = scheduleTimers.get(key)
  if (prev) clearTimeout(prev)
  scheduleTimers.set(
    key,
    setTimeout(() => {
      scheduleTimers.delete(key)
      void runWorkspaceSemanticIndex(workspaceId, opts).catch((e) => {
        console.warn('[semantic index]', e)
      })
    }, debounceMs),
  )
}

export async function rebuildWorkspaceSemanticIndexFull(
  workspaceId: string,
): Promise<void> {
  await retrievalClearWorkspace(workspaceId)
  await runWorkspaceSemanticIndex(workspaceId)
}

export async function runWorkspaceSemanticIndex(
  workspaceId: string,
  opts?: { conversationId?: string; memoryRelativePath?: string },
): Promise<void> {
  if (!isTauri()) return
  const settings = await aiSettingsGet()
  if (!canEmbed(settings)) return

  if (opts?.conversationId) {
    await indexConversation(workspaceId, opts.conversationId, settings)
    return
  }
  if (opts?.memoryRelativePath) {
    await indexMemoryPath(workspaceId, opts.memoryRelativePath, settings)
    return
  }

  await indexAllConversations(workspaceId, settings)
  await indexAllMemory(workspaceId, settings)
  await indexAllRepoFiles(workspaceId, settings)
}

async function indexAllConversations(
  workspaceId: string,
  settings: AiSettingsDto,
): Promise<void> {
  const list = await conversationList(workspaceId)
  for (const c of list) {
    await indexConversation(workspaceId, c.id, settings)
  }
}

async function indexAllMemory(
  workspaceId: string,
  settings: AiSettingsDto,
): Promise<void> {
  const paths = await listSemanticMemoryRecordPaths(workspaceId)
  for (const p of paths) {
    await indexMemoryPath(workspaceId, p, settings)
  }
}

async function indexAllRepoFiles(
  workspaceId: string,
  settings: AiSettingsDto,
): Promise<void> {
  const files = await workspaceListAllFiles(workspaceId)
  for (const f of files) {
    const rel = posix(f.relativePath)
    const parts = rel.split('/').filter(Boolean)
    if (walkRelativeParts(parts)) continue
    if (shouldSkipSecretsPath(rel)) continue
    await indexRepoFile(workspaceId, rel, settings)
  }
}

async function indexRepoFile(
  workspaceId: string,
  relativePath: string,
  settings: AiSettingsDto,
): Promise<void> {
  const sourceId = `file:${relativePath}`
  let text: string
  try {
    const r = await workspaceReadTextFile(workspaceId, relativePath, READ_MAX)
    text = r.text
  } catch {
    return
  }
  const hash = await sha256Hex(text)
  const prev = await retrievalGetSourceState(workspaceId, sourceId)
  if (prev?.contentHash === hash) return

  const chunks = chunkPlainText(text, {
    maxTokens: CHUNK_MAX_TOKENS,
    overlapRatio: CHUNK_OVERLAP,
  })
  if (chunks.length === 0) {
    await retrievalPutSourceState({
      workspaceId,
      entries: [{ sourceId, contentHash: hash, mtimeMs: null }],
    })
    return
  }

  const modelId = embeddingModelIdForStorage(settings)
  if (!modelId) return

  const inputs: RetrievalChunkInput[] = []
  const texts: string[] = []
  let ord = 0
  for (const c of chunks) {
    const header = formatFileChunkHeader(relativePath, c.lineStart, c.lineEnd)
    const body = `${header}\n${c.text}`
    texts.push(body)
    const ref = JSON.stringify({
      path: relativePath,
      lineStart: c.lineStart,
      lineEnd: c.lineEnd,
    })
    inputs.push({
      chunkOrdinal: ord,
      sourceKind: 'file',
      sourceRef: ref,
      bodyText: body,
      contentHash: await sha256Hex(body),
      embeddingModelId: modelId,
      embeddingDim: 0,
      embedding: [],
    })
    ord += 1
  }

  await fillEmbeddings(settings, inputs, texts)
  await retrievalReplaceSourceChunks({
    workspaceId,
    sourceId,
    chunks: inputs,
  })
  await retrievalPutSourceState({
    workspaceId,
    entries: [{ sourceId, contentHash: hash, mtimeMs: null }],
  })
}

async function fillEmbeddings(
  settings: AiSettingsDto,
  inputs: RetrievalChunkInput[],
  texts: string[],
): Promise<void> {
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batchTexts = texts.slice(i, i + EMBED_BATCH)
    const { vectors } = await embedTexts(settings, batchTexts, 'document')
    for (let j = 0; j < vectors.length; j++) {
      const idx = i + j
      const v = vectors[j]
      inputs[idx].embeddingDim = v.length
      inputs[idx].embedding = v
    }
  }
}

export async function indexConversation(
  workspaceId: string,
  conversationId: string,
  settings: AiSettingsDto,
): Promise<void> {
  const rel = `.braian/conversations/${conversationId}.json`
  const sourceId = `conversation:${conversationId}`
  let text: string
  try {
    const r = await workspaceReadTextFile(workspaceId, rel, READ_MAX)
    text = r.text
  } catch {
    return
  }
  const hash = await sha256Hex(text)
  const prev = await retrievalGetSourceState(workspaceId, sourceId)
  if (prev?.contentHash === hash) return

  let parsed: { messages?: Array<{ id: string; role: string; content: string }> }
  try {
    parsed = JSON.parse(text) as {
      messages?: Array<{ id: string; role: string; content: string }>
    }
  } catch {
    return
  }
  const messages = parsed.messages ?? []
  const modelId = embeddingModelIdForStorage(settings)
  if (!modelId) return

  if (messages.length === 0) {
    await retrievalReplaceSourceChunks({ workspaceId, sourceId, chunks: [] })
    await retrievalPutSourceState({
      workspaceId,
      entries: [{ sourceId, contentHash: hash, mtimeMs: null }],
    })
    return
  }

  const msgChunks = chunkMessagesByTokens(messages, CHUNK_MAX_TOKENS, CHUNK_OVERLAP)
  const inputs: RetrievalChunkInput[] = []
  const texts: string[] = []
  let ord = 0
  for (const mc of msgChunks) {
    const header = formatConversationChunkHeader(
      conversationId,
      mc.messageStart + 1,
      mc.messageEnd + 1,
    )
    const body = `${header}\n${mc.text}`
    texts.push(body)
    const ref = JSON.stringify({
      conversationId,
      messageStart: mc.messageStart,
      messageEnd: mc.messageEnd,
    })
    inputs.push({
      chunkOrdinal: ord,
      sourceKind: 'conversation',
      sourceRef: ref,
      bodyText: body,
      contentHash: await sha256Hex(body),
      embeddingModelId: modelId,
      embeddingDim: 0,
      embedding: [],
    })
    ord += 1
  }

  await fillEmbeddings(settings, inputs, texts)
  await retrievalReplaceSourceChunks({ workspaceId, sourceId, chunks: inputs })
  await retrievalPutSourceState({
    workspaceId,
    entries: [{ sourceId, contentHash: hash, mtimeMs: null }],
  })
}

async function indexMemoryPath(
  workspaceId: string,
  relativePath: string,
  settings: AiSettingsDto,
): Promise<void> {
  const record = await readSemanticMemoryRecord(workspaceId, relativePath)
  const sourceId = `memory:${posix(relativePath)}`
  if (!record) {
    await retrievalReplaceSourceChunks({ workspaceId, sourceId, chunks: [] })
    return
  }

  const textBody = [
    record.summary,
    record.text,
    ...(record.tags ?? []),
    JSON.stringify(record.sourceRefs ?? []),
  ].join('\n')
  const hash = await sha256Hex(textBody)
  const prev = await retrievalGetSourceState(workspaceId, sourceId)
  if (prev?.contentHash === hash) return

  const modelId = embeddingModelIdForStorage(settings)
  if (!modelId) return

  const chunks = chunkPlainText(textBody, {
    maxTokens: CHUNK_MAX_TOKENS,
    overlapRatio: CHUNK_OVERLAP,
  })
  if (chunks.length === 0) {
    await retrievalPutSourceState({
      workspaceId,
      entries: [{ sourceId, contentHash: hash, mtimeMs: null }],
    })
    return
  }

  const inputs: RetrievalChunkInput[] = []
  const texts: string[] = []
  let ord = 0
  for (const c of chunks) {
    const header = formatMemoryChunkHeader(relativePath, record.id)
    const body = `${header}\n${c.text}`
    texts.push(body)
    const ref = JSON.stringify({
      path: relativePath,
      kind: record.kind,
      entryId: record.id,
      lineStart: c.lineStart,
      lineEnd: c.lineEnd,
    })
    inputs.push({
      chunkOrdinal: ord,
      sourceKind: 'memory_json',
      sourceRef: ref,
      bodyText: body,
      contentHash: await sha256Hex(body),
      embeddingModelId: modelId,
      embeddingDim: 0,
      embedding: [],
    })
    ord += 1
  }

  await fillEmbeddings(settings, inputs, texts)
  await retrievalReplaceSourceChunks({ workspaceId, sourceId, chunks: inputs })
  await retrievalPutSourceState({
    workspaceId,
    entries: [{ sourceId, contentHash: hash, mtimeMs: null }],
  })
}
