import { describe, expect, it } from 'vitest'

import {
  isLegacySkillRelativePath,
  isSkillBundlePath,
  isSkillMainPath,
  normalizeWorkspaceRelativePath,
  resolveSkillPathArg,
} from './skill-path'

describe('skill-path', () => {
  it('allows legacy top-level .md under .braian/skills', () => {
    expect(isLegacySkillRelativePath('.braian/skills/foo.md')).toBe(true)
  })

  it('rejects nested paths for legacy top-level rule', () => {
    expect(isLegacySkillRelativePath('.braian/skills/nested/foo.md')).toBe(false)
    expect(isLegacySkillRelativePath('.braian/skills/../MEMORY.md')).toBe(false)
    expect(isLegacySkillRelativePath('skills/foo.md')).toBe(false)
  })

  it('detects canonical SKILL.md main path', () => {
    expect(isSkillMainPath('.braian/skills/foo/SKILL.md')).toBe(true)
    expect(isSkillMainPath('.braian/skills/foo/skill.md')).toBe(true)
    expect(isSkillMainPath('.braian/skills/foo.md')).toBe(false)
    expect(isSkillMainPath('.braian/skills/foo/bar.md')).toBe(false)
  })

  it('detects bundle paths (slug + at least one segment)', () => {
    expect(isSkillBundlePath('.braian/skills/foo/SKILL.md')).toBe(true)
    expect(isSkillBundlePath('.braian/skills/foo/references/x.md')).toBe(true)
    expect(isSkillBundlePath('.braian/skills/foo.md')).toBe(false)
    expect(isSkillBundlePath('.braian/skills/')).toBe(false)
  })

  it('resolveSkillPathArg maps slug and bundle shorthands', () => {
    expect(resolveSkillPathArg('create-skill')).toBe(
      '.braian/skills/create-skill/SKILL.md',
    )
    expect(resolveSkillPathArg('create-skill/references/notes.md')).toBe(
      '.braian/skills/create-skill/references/notes.md',
    )
    expect(resolveSkillPathArg('create-skill.md')).toBe(
      '.braian/skills/create-skill.md',
    )
    expect(resolveSkillPathArg('.braian/skills/x/SKILL.md')).toBe(
      '.braian/skills/x/SKILL.md',
    )
    expect(resolveSkillPathArg('.braian/skills/../evil.md')).toBe(null)
  })

  it('normalizeWorkspaceRelativePath converts backslashes', () => {
    expect(normalizeWorkspaceRelativePath('.braian\\skills\\x.md')).toBe(
      '.braian/skills/x.md',
    )
  })
})
