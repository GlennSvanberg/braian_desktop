import { describe, expect, it } from 'vitest'

import { parseSkillMarkdown, tryParseSkillMarkdown } from './parse-skill-md'

describe('parseSkillMarkdown', () => {
  it('parses name, description, and body', () => {
    const raw = `---
name: test-skill
description: When testing parsers.
---

# Hello

Body here.
`
    const r = parseSkillMarkdown(raw)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.frontmatter.name).toBe('test-skill')
    expect(r.frontmatter.description).toBe('When testing parsers.')
    expect(r.body).toContain('Body here.')
  })

  it('strips BOM', () => {
    const raw = `\uFEFF---
name: x
description: y
---

ok
`
    const r = parseSkillMarkdown(raw)
    expect(r.ok).toBe(true)
  })

  it('rejects missing frontmatter', () => {
    const r = parseSkillMarkdown('# No fm\n')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.message).toMatch(/frontmatter/i)
  })

  it('rejects empty name', () => {
    const r = parseSkillMarkdown(`---
name:
description: d
---
`)
    expect(r.ok).toBe(false)
  })

  it('tryParseSkillMarkdown returns null on error', () => {
    expect(tryParseSkillMarkdown('bad')).toBeNull()
  })
})
