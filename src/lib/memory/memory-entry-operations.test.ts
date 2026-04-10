import { describe, expect, it } from 'vitest'

import { memoryEntryRelativePath } from '@/lib/memory/memory-entry-operations'

describe('memoryEntryRelativePath', () => {
  it('maps kind to subfolder and id to filename', () => {
    expect(memoryEntryRelativePath('fact', 'mem_abc123')).toBe(
      '.braian/memory/facts/mem_abc123.json',
    )
    expect(memoryEntryRelativePath('decision', 'mem_xyz')).toBe(
      '.braian/memory/decisions/mem_xyz.json',
    )
  })
})
