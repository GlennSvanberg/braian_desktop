import type { AiSettingsDto } from '@/lib/ai-settings-api'
import { estimateTextTokens } from '@/lib/ai/token-estimate'
import type { AiProviderId } from '@/lib/ai/model-catalog'
import {
  canEmbed,
  embedQueryText,
  embeddingModelIdForStorage,
} from '@/lib/ai/embedding-client'
import type {
  WorkspaceSearchMatch,
  WorkspaceSearchResult,
} from '@/lib/workspace-api'
import { workspaceSearchText } from '@/lib/workspace-api'
import { retrievalSearch, type RetrievalSearchHit } from '@/lib/retrieval/retrieval-api'

const TOKEN_OPTS = { provider: 'openai' as AiProviderId, modelId: 'gpt-4o' }

export type HybridSemanticRow = {
  kind: 'semantic'
  score: number
  sourceKind: string
  sourceRef: string
  bodyText: string
}

export type HybridWorkspaceSearchResult = WorkspaceSearchResult & {
  semanticHits: HybridSemanticRow[]
  /** Lexical first (by rank), then semantic hits not redundant with lexical path+line */
  mergedPreview: Array<
    | { kind: 'lexical'; match: WorkspaceSearchMatch; lexicalRank: number }
    | { kind: 'semantic'; row: HybridSemanticRow }
  >
  semanticSkippedReason?: string
}

function parseFilePathFromRef(
  sourceKind: string,
  sourceRef: string,
): string | null {
  if (sourceKind !== 'file') return null
  try {
    const j = JSON.parse(sourceRef) as { path?: string }
    return typeof j.path === 'string' ? j.path : null
  } catch {
    return null
  }
}

function lexicalKey(m: WorkspaceSearchMatch): string {
  return `${m.relativePath}:${m.lineNumber}`
}

/**
 * Lexical workspace search plus optional semantic neighbors (same query string).
 */
export async function hybridWorkspaceSearch(input: {
  workspaceId: string
  query: string
  fileGlob?: string | null
  caseInsensitive?: boolean | null
  maxResults?: number | null
  settings: AiSettingsDto
  /** When false, only lexical (e.g. tool prefers speed). */
  includeSemantic?: boolean
}): Promise<HybridWorkspaceSearchResult> {
  const maxLex = input.maxResults ?? 80
  const lexical = await workspaceSearchText({
    workspaceId: input.workspaceId,
    query: input.query,
    fileGlob: input.fileGlob ?? null,
    caseInsensitive: input.caseInsensitive ?? true,
    maxResults: maxLex,
  })

  const base: HybridWorkspaceSearchResult = {
    ...lexical,
    semanticHits: [],
    mergedPreview: [],
  }

  if (input.includeSemantic === false || !canEmbed(input.settings)) {
    base.semanticSkippedReason = !canEmbed(input.settings)
      ? 'Semantic search requires a configured embedding provider (see Settings).'
      : undefined
    base.mergedPreview = lexical.matches.map((m, i) => ({
      kind: 'lexical' as const,
      match: m,
      lexicalRank: i + 1,
    }))
    return base
  }

  const modelId = embeddingModelIdForStorage(input.settings)
  if (!modelId) {
    base.semanticSkippedReason = 'No embedding model resolved.'
    base.mergedPreview = lexical.matches.map((m, i) => ({
      kind: 'lexical' as const,
      match: m,
      lexicalRank: i + 1,
    }))
    return base
  }

  let hits: RetrievalSearchHit[] = []
  try {
    const { vector } = await embedQueryText(input.settings, input.query.trim())
    hits = await retrievalSearch({
      workspaceId: input.workspaceId,
      queryEmbedding: vector,
      embeddingModelId: modelId,
      topK: Math.min(24, maxLex),
    })
  } catch (e) {
    base.semanticSkippedReason =
      e instanceof Error ? e.message : 'Semantic search failed.'
    base.mergedPreview = lexical.matches.map((m, i) => ({
      kind: 'lexical' as const,
      match: m,
      lexicalRank: i + 1,
    }))
    return base
  }

  const semanticRows: HybridSemanticRow[] = hits.map((h) => ({
    kind: 'semantic' as const,
    score: h.score,
    sourceKind: h.sourceKind,
    sourceRef: h.sourceRef,
    bodyText: h.bodyText,
  }))
  base.semanticHits = semanticRows

  const lexicalKeys = new Set(lexical.matches.map(lexicalKey))
  const merged: HybridWorkspaceSearchResult['mergedPreview'] = []

  for (let i = 0; i < lexical.matches.length; i++) {
    merged.push({
      kind: 'lexical',
      match: lexical.matches[i],
      lexicalRank: i + 1,
    })
  }

  for (const row of semanticRows) {
    const p = parseFilePathFromRef(row.sourceKind, row.sourceRef)
    if (p) {
      const lineGuess = row.bodyText.match(/lines=(\d+)-(\d+)/)
      const ln = lineGuess ? Number(lineGuess[1]) : 0
      const key = `${p}:${ln}`
      if (lexicalKeys.has(key)) continue
    }
    merged.push({ kind: 'semantic', row })
  }

  base.mergedPreview = merged
  return base
}

/**
 * Build system prompt text from retrieval hits within a token budget.
 */
export function trimRetrievalHitsToTokenBudget(
  hits: RetrievalSearchHit[],
  maxTokens: number,
): string {
  const lines: string[] = []
  let used = 0
  for (let i = 0; i < hits.length; i++) {
    const block = `### Snippet ${i + 1} (similarity ${hits[i].score.toFixed(3)})\n${hits[i].bodyText}\n`
    const t = estimateTextTokens(block, TOKEN_OPTS)
    if (used + t > maxTokens) break
    lines.push(block)
    used += t
  }
  return lines.join('\n')
}
