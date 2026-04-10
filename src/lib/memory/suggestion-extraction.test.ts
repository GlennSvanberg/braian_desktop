import { describe, expect, it } from 'vitest'
import { z } from 'zod'

/** Mirror of suggestion-extraction response shape for unit tests. */
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

describe('suggestion extraction schema', () => {
  it('accepts valid payload', () => {
    const raw = {
      suggestions: [
        {
          proposedKind: 'fact',
          candidateText: 'Use pnpm',
          confidence: 0.8,
        },
      ],
    }
    expect(extractResponseSchema.safeParse(raw).success).toBe(true)
  })

  it('rejects empty candidateText', () => {
    const raw = {
      suggestions: [
        {
          proposedKind: 'preference',
          candidateText: '',
          confidence: 0.5,
        },
      ],
    }
    expect(extractResponseSchema.safeParse(raw).success).toBe(false)
  })
})
