export type MockWorkspace = {
  id: string
  name: string
  description: string
}

export type MockConversation = {
  id: string
  workspaceId: string
  title: string
  updatedLabel: string
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
  },
  {
    id: 'conv-spec',
    workspaceId: 'ws-personal',
    title: 'Product spec v2',
    updatedLabel: 'Yesterday',
  },
  {
    id: 'conv-ideas',
    workspaceId: 'ws-personal',
    title: 'Artifact ideas',
    updatedLabel: 'Mon',
  },
  {
    id: 'conv-brand',
    workspaceId: 'ws-acme',
    title: 'Brand refresh brief',
    updatedLabel: 'Today',
  },
  {
    id: 'conv-dashboards',
    workspaceId: 'ws-acme',
    title: 'Dashboard mockups',
    updatedLabel: 'Wed',
  },
  {
    id: 'conv-paper',
    workspaceId: 'ws-research',
    title: 'Paper synthesis',
    updatedLabel: 'Last week',
  },
]

export function getConversationsForWorkspace(workspaceId: string) {
  return MOCK_CONVERSATIONS.filter((c) => c.workspaceId === workspaceId)
}

export function getConversationById(conversationId: string) {
  return MOCK_CONVERSATIONS.find((c) => c.id === conversationId)
}
