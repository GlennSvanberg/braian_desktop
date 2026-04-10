import { completeChatText } from '@/lib/ai/complete-text'
import { isMockAiMode } from '@/lib/ai/mock-mode'
import { writeMemorySuggestion } from '@/lib/memory/suggestion-queue'
import { z } from 'zod'

const EXTRACT_SYSTEM = `You extract **candidate structured memory items** for a coding workspace assistant.

Output **only** a single JSON object (no markdown fences, no commentary) with this exact shape:
{
  "suggestions": [
    {
      "proposedKind": "fact",
      "candidateText": "short durable statement",
      "confidence": 0.75
    }
  ]
}

Rules:
- Max **3** suggestions; use an empty array if nothing is worth promoting.
- "proposedKind" must be one of: fact, decision, preference, episode, pattern.
- "candidateText" must be workspace-specific, durable, and grounded in the excerpt (no invention).
- "confidence" between 0 and 1 (how safe it is to promote).
- Omit secrets, API keys, and one-off tasks.`

const extractResponseSchema = z.object({
  suggestions: z.array(
    z.object({
      proposedKind: z.enum([
        'fact',
        'decision',
        'preference',
        'episode',
        'pattern',
      ]),
      candidateText: z.string().min(1),
      confidence: z.number().min(0).max(1),
    }),
  ),
})

function parseJsonObject(raw: string): unknown {
  let t = raw.trim()
  const fence = /^```(?:json)?\s*\n([\s\S]*?)\n```/m.exec(t)
  if (fence) t = fence[1].trim()
  return JSON.parse(t) as unknown
}

/**
 * After a successful markdown memory review, optionally queue structured-memory suggestions (file-backed).
 * Best-effort: failures are logged and do not throw.
 */
export async function queueStructuredSuggestionsFromReviewExcerpt(options: {
  workspaceId: string
  conversationId: string
  transcriptExcerpt: string
  signal?: AbortSignal
}): Promise<void> {
  if (isMockAiMode()) return
  const excerpt = options.transcriptExcerpt.trim()
  if (excerpt.length < 20) return

  try {
    const raw = await completeChatText({
      systemPrompts: [EXTRACT_SYSTEM],
      userMessage: [
        'Conversation excerpt (merge candidates from this only):',
        '',
        excerpt,
      ].join('\n'),
      signal: options.signal,
    })
    const parsed = parseJsonObject(raw)
    const out = extractResponseSchema.safeParse(parsed)
    if (!out.success) {
      console.warn('[braian] suggestion extraction: invalid JSON', out.error.message)
      return
    }
    const list = out.data.suggestions.slice(0, 3)
    for (const s of list) {
      const r = await writeMemorySuggestion(options.workspaceId, {
        proposedKind: s.proposedKind,
        candidateText: s.candidateText,
        confidence: s.confidence,
        sourceConversationId: options.conversationId,
      })
      if (!r.ok) {
        console.warn('[braian] suggestion write failed:', r.error)
      }
    }
  } catch (e) {
    console.warn('[braian] queueStructuredSuggestionsFromReviewExcerpt', e)
  }
}
