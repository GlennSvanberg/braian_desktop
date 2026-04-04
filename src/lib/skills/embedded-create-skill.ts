/**
 * Used when `.braian/skills/create-skill.md` is missing or unreadable (e.g. web preview).
 * Keep in sync with `src-tauri/skills-default/create-skill.md` body after frontmatter.
 */
export const EMBEDDED_CREATE_SKILL_MARKDOWN = `## Braian workspace skills

In this app, skills live as Markdown files under \`.braian/skills/\` in the active workspace. Each file must start with YAML frontmatter:

\`\`\`yaml
---
name: my-skill
description: One line explaining when to use this skill.
---
\`\`\`

Then write concise instructions in Markdown below the closing \`---\`.

## Create Skill

Guide for creating effective skills that extend agent capabilities with specialized knowledge, workflows, and tool integrations.

### About skills

Skills are modular instructions the model loads **on demand** via \`read_workspace_skill\`. The **catalog** (name + description) is always visible; the body loads when needed.

### Progressive disclosure

Keep each skill focused. Prefer short files; split long reference into separate skills or workspace docs.

### Core principles

- Be concise — the context window is shared with chat, memory, and tools.
- Use \`list_workspace_skills\` / \`read_workspace_skill\` before claiming a workflow you have not loaded.
- After editing a skill file with \`write_workspace_skill\`, the next turn’s catalog will reflect it.

### Structure (Braian)

- One \`.md\` file per skill under \`.braian/skills/\`.
- Required frontmatter: \`name\`, \`description\`.
- Optional: keep related scripts in the workspace (e.g. \`scripts/\`) and reference paths in the skill body.
`
