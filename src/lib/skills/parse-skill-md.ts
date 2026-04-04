export type SkillFrontmatter = {
  name: string
  description: string
}

export type ParsedSkillMd = {
  frontmatter: SkillFrontmatter
  body: string
}

export type ParseSkillMdError = {
  ok: false
  message: string
}

export type ParseSkillMdOk = ParsedSkillMd & { ok: true }

export type ParseSkillMdResult = ParseSkillMdOk | ParseSkillMdError

const FRONTMATTER_RE =
  /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/

/**
 * Parses Braian skill markdown: YAML frontmatter with required `name` and `description`.
 */
export function parseSkillMarkdown(raw: string): ParseSkillMdResult {
  const m = raw.match(FRONTMATTER_RE)
  if (!m) {
    return {
      ok: false as const,
      message:
        'Skill file must start with YAML frontmatter: ---\\nname: ...\\ndescription: ...\\n---',
    }
  }
  const yamlBlock = m[1] ?? ''
  const body = (m[2] ?? '').trimStart()
  const fm = parseSimpleYamlScalars(yamlBlock)
  const name = fm.name?.trim()
  const description = fm.description?.trim()
  if (!name) {
    return {
      ok: false as const,
      message: 'Frontmatter must include non-empty `name:`.',
    }
  }
  if (!description) {
    return {
      ok: false as const,
      message: 'Frontmatter must include non-empty `description:`.',
    }
  }
  return {
    ok: true as const,
    frontmatter: { name, description },
    body,
  }
}

/** Exported for tests: treat as valid skill file. */
export function tryParseSkillMarkdown(raw: string): ParsedSkillMd | null {
  const r = parseSkillMarkdown(raw)
  if (!r.ok) return null
  return { frontmatter: r.frontmatter, body: r.body }
}

/** Single-line `key: value` YAML scalars (optional quotes). */
function parseSimpleYamlScalars(yaml: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const rawLine of yaml.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim()
    if (!/^[a-zA-Z0-9_-]+$/.test(key)) continue
    let v = line.slice(idx + 1).trim()
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1)
    }
    out[key] = v
  }
  return out
}
