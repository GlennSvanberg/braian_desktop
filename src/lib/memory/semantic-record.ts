import { z } from 'zod'

import type { SemanticMemoryKindDir } from '@/lib/memory/constants'

export const MEMORY_ENTRY_STATUSES = [
  'active',
  'stale',
  'superseded',
  'archived',
] as const

export type MemoryEntryStatus = (typeof MEMORY_ENTRY_STATUSES)[number]

export const MEMORY_SCOPES = ['workspace', 'global', 'session'] as const
export type MemoryScope = (typeof MEMORY_SCOPES)[number]

const sourceRefFile = z.object({
  type: z.literal('file'),
  path: z.string(),
})

const sourceRefConversation = z.object({
  type: z.literal('conversation'),
  conversationId: z.string(),
})

const sourceRefTool = z.object({
  type: z.literal('tool'),
  toolName: z.string(),
  note: z.string().optional(),
})

export const memorySourceRefSchema = z.union([
  sourceRefFile,
  sourceRefConversation,
  sourceRefTool,
])

export type MemorySourceRef = z.infer<typeof memorySourceRefSchema>

export const semanticMemoryRecordSchemaV1 = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  kind: z.enum([
    'fact',
    'decision',
    'preference',
    'episode',
    'pattern',
  ]),
  scope: z.enum(['workspace', 'global', 'session']),
  text: z.string(),
  summary: z.string(),
  confidence: z.number().min(0).max(1),
  status: z.enum(['active', 'stale', 'superseded', 'archived']),
  tags: z.array(z.string()),
  sourceRefs: z.array(memorySourceRefSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastValidatedAt: z.string().optional(),
  supersedes: z.array(z.string()),
})

export type SemanticMemoryRecordV1 = z.infer<typeof semanticMemoryRecordSchemaV1>

export function kindToDir(kind: SemanticMemoryRecordV1['kind']): SemanticMemoryKindDir {
  const m: Record<SemanticMemoryRecordV1['kind'], SemanticMemoryKindDir> = {
    fact: 'facts',
    decision: 'decisions',
    preference: 'preferences',
    episode: 'episodes',
    pattern: 'patterns',
  }
  return m[kind]
}

export function newMemoryId(): string {
  const u =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, '')
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
  return `mem_${u.slice(0, 20)}`
}
