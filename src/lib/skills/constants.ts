/** Workspace-relative directory for Braian skills (Markdown + YAML frontmatter). */
export const SKILLS_DIR_RELATIVE_PATH = '.braian/skills'

/** Canonical skill instructions filename inside each skill directory. */
export const SKILL_MD_FILENAME = 'SKILL.md'

/** Default folder for the always-injected “how to create skills” skill. */
export const CREATE_SKILL_DIRNAME = 'create-skill'

/** Skill folder with dashboard/webapp builder instructions. */
export const APP_BUILDER_SKILL_DIRNAME = 'app-builder'

/** Legacy flat markdown filename for create-skill compatibility. */
export const CREATE_SKILL_LEGACY_FILENAME = 'create-skill.md'

/** Legacy flat markdown filename for app-builder compatibility. */
export const APP_BUILDER_SKILL_LEGACY_FILENAME = 'app-builder.md'

/** Max bytes read per skill file when building the catalog (metadata + start of body). */
export const SKILL_CATALOG_READ_MAX_BYTES = 16 * 1024

/** Max skill files scanned per workspace for the catalog. */
export const SKILL_CATALOG_MAX_FILES = 64
