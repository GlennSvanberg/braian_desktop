/** Workspace-relative directory for Braian skills (Markdown + YAML frontmatter). */
export const SKILLS_DIR_RELATIVE_PATH = '.braian/skills'

/** Default filename for the always-injected “how to create skills” skill. */
export const CREATE_SKILL_FILENAME = 'create-skill.md'

/** Skill with dashboard JSON schema (loaded when app harness is on). */
export const APP_BUILDER_SKILL_FILENAME = 'app-builder.md'

/** Max bytes read per skill file when building the catalog (metadata + start of body). */
export const SKILL_CATALOG_READ_MAX_BYTES = 16 * 1024

/** Max skill files scanned per workspace for the catalog. */
export const SKILL_CATALOG_MAX_FILES = 64
