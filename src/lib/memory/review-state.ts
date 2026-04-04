import {
  workspaceReadTextFile,
  workspaceWriteTextFile,
} from '@/lib/workspace-api'

import { MEMORY_REVIEW_STATE_RELATIVE_PATH } from './constants'

export type MemoryReviewStateFile = {
  version: 1
  byConversation: Record<string, { lastReviewedUserMessageId: string | null }>
}

const emptyState = (): MemoryReviewStateFile => ({
  version: 1,
  byConversation: {},
})

export async function readMemoryReviewState(
  workspaceId: string,
): Promise<MemoryReviewStateFile> {
  try {
    const { text } = await workspaceReadTextFile(
      workspaceId,
      MEMORY_REVIEW_STATE_RELATIVE_PATH,
      256 * 1024,
    )
    const parsed = JSON.parse(text) as MemoryReviewStateFile
    if (parsed?.version !== 1 || typeof parsed.byConversation !== 'object') {
      return emptyState()
    }
    return parsed
  } catch {
    return emptyState()
  }
}

export async function writeMemoryReviewState(
  workspaceId: string,
  state: MemoryReviewStateFile,
): Promise<void> {
  const json = `${JSON.stringify(state, null, 2)}\n`
  await workspaceWriteTextFile(
    workspaceId,
    MEMORY_REVIEW_STATE_RELATIVE_PATH,
    json,
  )
}

export function getLastReviewedUserMessageId(
  state: MemoryReviewStateFile,
  conversationId: string,
): string | null {
  return state.byConversation[conversationId]?.lastReviewedUserMessageId ?? null
}

export function setLastReviewedUserMessageId(
  state: MemoryReviewStateFile,
  conversationId: string,
  userMessageId: string | null,
): MemoryReviewStateFile {
  return {
    ...state,
    byConversation: {
      ...state.byConversation,
      [conversationId]: { lastReviewedUserMessageId: userMessageId },
    },
  }
}
