import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as workspaceApi from '@/lib/workspace-api'

import { loadContextFilesForModel } from './context-files-for-ai'

vi.mock('@/lib/workspace-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/workspace-api')>()
  return {
    ...actual,
    workspaceReadTextFile: vi.fn(),
  }
})

describe('loadContextFilesForModel', () => {
  beforeEach(() => {
    vi.mocked(workspaceApi.workspaceReadTextFile).mockReset()
  })

  it('uses markdown head preview for csv instead of raw paste', async () => {
    vi.mocked(workspaceApi.workspaceReadTextFile).mockResolvedValue({
      text: 'Name,Score\nAlice,10\n',
      truncated: false,
    })
    const out = await loadContextFilesForModel('ws-1', [
      { relativePath: 'data/x.csv', displayName: 'x.csv' },
    ])
    expect(out).toHaveLength(1)
    expect(out[0]!.text).toContain('### Attached data file')
    expect(out[0]!.text).toContain('| Name | Score |')
    expect(out[0]!.text).toContain('| Alice | 10 |')
    expect(out[0]!.text).not.toMatch(/^Name,Score\nAlice/m)
  })

  it('passes through non-csv as raw text', async () => {
    vi.mocked(workspaceApi.workspaceReadTextFile).mockResolvedValue({
      text: 'hello world',
      truncated: false,
    })
    const out = await loadContextFilesForModel('ws-1', [
      { relativePath: 'note.txt' },
    ])
    expect(out[0]!.text).toBe('hello world')
  })
})
