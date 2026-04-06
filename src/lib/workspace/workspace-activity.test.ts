import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

const tryCommit = vi.hoisted(() => vi.fn().mockResolvedValue('commit-oid'))
const scheduleMemory = vi.hoisted(() => vi.fn())

vi.mock('@/lib/tauri-env', () => ({
  isTauri: () => true,
}))

vi.mock('@/lib/workspace/git-history-api', () => ({
  workspaceGitTryCommit: tryCommit,
}))

vi.mock('@/lib/memory/scheduler', () => ({
  scheduleMemoryReviewAfterIdle: scheduleMemory,
}))

import { PERSONAL_WORKSPACE_SESSION_ID } from '@/lib/chat-sessions/detached'

import {
  emitWorkspaceDurableActivity,
  GIT_CHECKPOINT_DEBOUNCE_MS,
  GIT_CHECKPOINT_MIN_INTERVAL_MS,
} from './workspace-activity'

describe('emitWorkspaceDurableActivity', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    tryCommit.mockClear()
    scheduleMemory.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('debounces multiple mutations into one tryCommit', async () => {
    emitWorkspaceDurableActivity('ws-a')
    emitWorkspaceDurableActivity('ws-a')
    emitWorkspaceDurableActivity('ws-a')
    expect(tryCommit).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(GIT_CHECKPOINT_DEBOUNCE_MS)
    expect(tryCommit).toHaveBeenCalledTimes(1)
    expect(tryCommit).toHaveBeenCalledWith('ws-a')
  })

  it('respects minimum interval between successful commits', async () => {
    tryCommit.mockResolvedValue('oid1')

    emitWorkspaceDurableActivity('ws-b')
    await vi.advanceTimersByTimeAsync(GIT_CHECKPOINT_DEBOUNCE_MS)
    expect(tryCommit).toHaveBeenCalledTimes(1)

    emitWorkspaceDurableActivity('ws-b')
    await vi.advanceTimersByTimeAsync(GIT_CHECKPOINT_DEBOUNCE_MS)
    expect(tryCommit).toHaveBeenCalledTimes(1)

    const wait =
      GIT_CHECKPOINT_MIN_INTERVAL_MS - GIT_CHECKPOINT_DEBOUNCE_MS
    await vi.advanceTimersByTimeAsync(wait)
    expect(tryCommit).toHaveBeenCalledTimes(2)
  })

  it('schedules memory review when conversationId is passed', async () => {
    emitWorkspaceDurableActivity('ws-c', { conversationId: 'conv-1' })
    await vi.waitFor(() => {
      expect(scheduleMemory).toHaveBeenCalledWith('ws-c', 'conv-1')
    })
  })

  it('does not schedule git or memory for built-in Simple chats workspace', async () => {
    emitWorkspaceDurableActivity(PERSONAL_WORKSPACE_SESSION_ID, {
      conversationId: 'conv-1',
    })
    await vi.advanceTimersByTimeAsync(GIT_CHECKPOINT_DEBOUNCE_MS)
    expect(tryCommit).not.toHaveBeenCalled()
    expect(scheduleMemory).not.toHaveBeenCalled()
  })
})
