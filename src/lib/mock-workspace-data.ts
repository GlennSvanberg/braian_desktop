export type MockWorkspace = {
  id: string
  name: string
  description: string
}

/** Which primary canvas the mock assistant opens for this thread (demo + AI contract). */
export type MockCanvasKind = 'document' | 'tabular' | 'visual'

export type MockDemoMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type MockConversation = {
  id: string
  workspaceId: string
  title: string
  updatedLabel: string
  canvasKind: MockCanvasKind
  /** Pre-filled thread + canvas when opening an empty session (product demos). */
  demoMessages?: MockDemoMessage[]
}

export const MOCK_WORKSPACES: MockWorkspace[] = [
  {
    id: 'ws-personal',
    name: 'Personal',
    description: 'Notes and experiments',
  },
  {
    id: 'ws-acme',
    name: 'Acme design',
    description: 'Client workspace',
  },
  {
    id: 'ws-research',
    name: 'Research',
    description: 'Literature and drafts',
  },
]

export const MOCK_CONVERSATIONS: MockConversation[] = [
  {
    id: 'conv-kickoff',
    workspaceId: 'ws-personal',
    title: 'Weekly planning',
    updatedLabel: 'Today',
    canvasKind: 'tabular',
  },
  {
    id: 'conv-spec',
    workspaceId: 'ws-personal',
    title: 'Product spec v2',
    updatedLabel: 'Yesterday',
    canvasKind: 'document',
  },
  {
    id: 'conv-ideas',
    workspaceId: 'ws-personal',
    title: 'Artifact ideas',
    updatedLabel: 'Mon',
    canvasKind: 'visual',
  },
  {
    id: 'conv-brand',
    workspaceId: 'ws-acme',
    title: 'Brand refresh brief',
    updatedLabel: 'Today',
    canvasKind: 'document',
  },
  {
    id: 'conv-dashboards',
    workspaceId: 'ws-acme',
    title: 'Dashboard mockups',
    updatedLabel: 'Wed',
    canvasKind: 'tabular',
  },
  {
    id: 'conv-excel-merge',
    workspaceId: 'ws-acme',
    title: 'Merge Q1 + Q2 sales',
    updatedLabel: 'Today',
    canvasKind: 'tabular',
    demoMessages: [
      {
        role: 'user',
        content:
          'In the sales folder I have two Excel exports for Q1 and Q2. Can you find them and show what’s in each file side by side?',
      },
      {
        role: 'assistant',
        content:
          'I found Q1_sales.xlsx and Q2_sales.xlsx. Both are on the canvas now — same columns (SKU, product, revenue, units) so you can scan them together. Q2 adds a row for SKU D-900 that isn’t in Q1.',
      },
      {
        role: 'user',
        content:
          'Merge them into one table by SKU: keep product name, add Q1 revenue, Q2 revenue, and a total column. Fill missing quarters with empty cells.',
      },
      {
        role: 'assistant',
        content:
          'Done. The third block is merged_by_ai.xlsx — one row per SKU with Q1 revenue, Q2 revenue, and Total. SKUs only in one quarter show a single side populated. Say if you want this exported or charted.',
      },
    ],
  },
  {
    id: 'conv-paper',
    workspaceId: 'ws-research',
    title: 'Paper synthesis',
    updatedLabel: 'Last week',
    canvasKind: 'visual',
  },
]

export function getConversationsForWorkspace(workspaceId: string) {
  return MOCK_CONVERSATIONS.filter((c) => c.workspaceId === workspaceId)
}

export function getConversationById(conversationId: string) {
  return MOCK_CONVERSATIONS.find((c) => c.id === conversationId)
}

/** Browser dev: update mock store title (mirrors desktop `conversation_set_title`). */
export function mockConversationSetTitle(id: string, title: string): void {
  const c = MOCK_CONVERSATIONS.find((x) => x.id === id)
  if (c) c.title = title.trim()
}

/** Browser dev: remove mock conversation (mirrors desktop `conversation_delete`). */
export function mockConversationDelete(id: string): void {
  const i = MOCK_CONVERSATIONS.findIndex((x) => x.id === id)
  if (i >= 0) MOCK_CONVERSATIONS.splice(i, 1)
}
