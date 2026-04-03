import type { WorkspaceArtifactPayload } from '@/lib/artifacts/types'

export type ChatRole = 'user' | 'assistant'

export type ChatMessage = {
  id: string
  role: ChatRole
  content: string
  status?: 'streaming' | 'complete'
}

export type ArtifactPayload = WorkspaceArtifactPayload

export type ChatThreadState = {
  messages: ChatMessage[]
  artifactOpen: boolean
  artifactPayload: ArtifactPayload | null
  draft: string
  /** Assistant turn in progress for this thread. */
  generating: boolean
}

export const DEFAULT_CHAT_THREAD: ChatThreadState = {
  messages: [],
  artifactOpen: false,
  artifactPayload: null,
  draft: '',
  generating: false,
}
