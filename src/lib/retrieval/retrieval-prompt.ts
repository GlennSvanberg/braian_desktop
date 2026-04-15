import type { AiSettingsDto } from '@/lib/ai-settings-api'
import {
  canEmbed,
  embedQueryText,
  embeddingModelIdForStorage,
} from '@/lib/ai/embedding-client'
import { retrievalSearch } from '@/lib/retrieval/retrieval-api'
import { trimRetrievalHitsToTokenBudget } from '@/lib/retrieval/hybrid-workspace-search'

export async function buildRetrievedContextSystemText(
  workspaceId: string,
  userText: string,
  settings: AiSettingsDto,
): Promise<string | null> {
  if (settings.retrievalAutoInject === 0) return null
  if (!userText.trim()) return null
  if (!canEmbed(settings)) return null
  const modelId = embeddingModelIdForStorage(settings)
  if (!modelId) return null

  const { vector } = await embedQueryText(settings, userText.trim())
  const hits = await retrievalSearch({
    workspaceId,
    queryEmbedding: vector,
    embeddingModelId: modelId,
    topK: 16,
  })
  if (hits.length === 0) return null

  const maxTok = settings.retrievalMaxTokens
  const body = trimRetrievalHitsToTokenBudget(hits, maxTok)
  if (!body.trim()) return null

  return [
    '## Retrieved workspace context',
    'Short excerpts from indexed files, past chats, and structured memory. They may be incomplete or stale; use **read_workspace_file**, **search_conversation_archive** / **open_conversation_span**, or **open_memory_entry** to verify and expand.',
    '',
    body,
  ].join('\n')
}
