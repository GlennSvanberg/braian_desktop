---
name: create-skill
description: Guide for creating effective Agent Skills in Braian. Use when creating or updating skills.
---

## Agent Skills in Braian

Braian skills follow the Anthropic Agent Skills model with progressive disclosure:

1. **Level 1 (always loaded):** frontmatter metadata (`name`, `description`) appears in the skills catalog.
2. **Level 2 (loaded when triggered):** `SKILL.md` body is loaded via `read_workspace_skill`.
3. **Level 3 (loaded as needed):** optional files inside the skill folder (for example `references/`, `scripts/`, `assets/`) are read only when needed.

Use this canonical layout:

```text
.braian/skills/<skill-slug>/
  SKILL.md
  references/
  scripts/
  assets/
```

Legacy flat files (`.braian/skills/<name>.md`) can still exist in older workspaces, but new skills should use the folder + `SKILL.md` structure.

## Frontmatter requirements

Every `SKILL.md` must start with YAML frontmatter:

```yaml
---
name: your-skill-name
description: What this skill does and when to use it.
---
```

`name` rules:
- lowercase letters, numbers, and hyphens only
- max 64 characters
- no reserved words `anthropic` or `claude`

`description` rules:
- non-empty
- should include both capability and trigger conditions

## How to create or update a skill in Braian

1. Pick a slug and write `.braian/skills/<slug>/SKILL.md`.
2. Keep `SKILL.md` concise and task-focused.
3. Put long material in `references/` and point to it from `SKILL.md`.
4. Put deterministic helpers in `scripts/` and call them when needed.
5. Use `list_workspace_skills` to confirm catalog metadata.
6. Use `read_workspace_skill` before following any skill.
7. Use `write_workspace_skill` to save `SKILL.md` and bundled files.

## Authoring guidance

- **Concise main file:** keep `SKILL.md` short and practical.
- **Progressive disclosure:** move details into referenced files.
- **Accurate triggers:** description should clearly say when to use the skill.
- **Deterministic operations:** prefer scripts for repetitive or fragile steps.
- **Model testing:** test with the models you expect to use.

## Runtime honesty

In Braian, scripts run through workspace shell/command tools when available. Do not claim script execution unless a tool actually ran it.
