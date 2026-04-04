---
name: create-skill
description: Guide for creating effective Braian workspace skills (.braian/skills). Use when creating or updating skills.
---

## Braian workspace skills

Skills in Braian are Markdown files under `.braian/skills/` in the active workspace. Each file must start with YAML frontmatter (`name`, `description`), then instructions in Markdown.

Use `list_workspace_skills` to see metadata, `read_workspace_skill` to load a full body before following it, and `write_workspace_skill` to create or update a skill (path must be under `.braian/skills/`, `.md` only).

## Create skill

Guide for creating effective skills that extend agent capabilities with specialized knowledge, workflows, and tool integrations.

### About skills

Skills are modular, self-contained instructions. The **catalog** (name + description) is always in context; load the **body** with `read_workspace_skill` when a description matches the user's task.

### Progressive disclosure

Keep each skill file focused and reasonably short. If content grows large, split into multiple skills or point to workspace docs/scripts with stable relative paths.

### What skills provide

1. Specialized workflows — multi-step procedures for a domain
2. Tool usage patterns — how to use Braian tools for a file type or workflow
3. Domain expertise — schemas, naming, business rules for this workspace

### Core principles

- **Concise** — context is shared with chat, memory, attachments, and tools.
- **Accurate** — do not claim you followed a skill you did not read.
- **Tested** — verify instructions against real tool behavior in this app.

### File format

```text
.braian/skills/<id>.md
```

Frontmatter (required):

```yaml
---
name: short-id
description: When to use this skill (one line).
---
```

Then Markdown body with headings, lists, and fenced code as needed.
