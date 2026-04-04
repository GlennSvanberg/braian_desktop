import { describe, expect, it } from 'vitest'

import { isAllowedSkillRelativePath, normalizeWorkspaceRelativePath } from './skill-path'

describe('skill-path', () => {
  it('allows direct .md under .braian/skills', () => {
    expect(isAllowedSkillRelativePath('.braian/skills/foo.md')).toBe(true)
  })

  it('rejects subfolders and parent segments', () => {
    expect(isAllowedSkillRelativePath('.braian/skills/nested/foo.md')).toBe(false)
    expect(isAllowedSkillRelativePath('.braian/skills/../MEMORY.md')).toBe(false)
    expect(isAllowedSkillRelativePath('skills/foo.md')).toBe(false)
  })

  it('normalizeWorkspaceRelativePath converts backslashes', () => {
    expect(normalizeWorkspaceRelativePath('.braian\\skills\\x.md')).toBe(
      '.braian/skills/x.md',
    )
  })
})
