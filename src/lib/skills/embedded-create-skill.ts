/**
 * Used when `.braian/skills/create-skill/SKILL.md` is missing or unreadable (e.g. web preview).
 * Keep in sync with `src-tauri/skills-default/create-skill/SKILL.md` body after frontmatter.
 */
export const EMBEDDED_CREATE_SKILL_MARKDOWN = `## Agent Skills in Braian

Braian skills follow Anthropic's progressive disclosure model:

1. Level 1 (always loaded): frontmatter metadata in the catalog.
2. Level 2 (when triggered): \`SKILL.md\` body loaded via \`read_workspace_skill\`.
3. Level 3 (as needed): bundled files under the same skill folder.

Use this layout:

\`\`\`text
.braian/skills/<skill-slug>/
  SKILL.md
  references/
  scripts/
  assets/
\`\`\`

Legacy flat files (\`.braian/skills/<name>.md\`) are still supported for compatibility, but new skills should use the folder + \`SKILL.md\` format.

### Frontmatter requirements

\`\`\`yaml
---
name: your-skill-name
description: What this skill does and when to use it.
---
\`\`\`

\`name\` should use lowercase letters, numbers, and hyphens only.

### Authoring guidance

- Keep \`SKILL.md\` concise.
- Move long details to \`references/\`.
- Use \`scripts/\` for deterministic repeated operations.
- Test with the models you plan to use.

### Braian tool mapping

- Use \`list_workspace_skills\` for metadata checks.
- Use \`read_workspace_skill\` before following a skill.
- Use \`write_workspace_skill\` to write \`SKILL.md\` or bundled files.

In Braian, scripts only run when shell/command tools are available and called. Do not claim execution unless it happened.
`
