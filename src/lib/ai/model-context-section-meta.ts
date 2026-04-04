/** Human-readable bucket for the Model context dialog. */
export type ModelContextSectionGroup =
  | 'Core'
  | 'Skills'
  | 'User'
  | 'Workspace'
  | 'This turn'
  | 'Profile'

export function modelContextSectionGroup(
  sectionId: string,
): ModelContextSectionGroup {
  switch (sectionId) {
    case 'routing-doc':
    case 'routing-code':
      return 'Core'
    case 'skills-create':
    case 'skills-catalog':
      return 'Skills'
    case 'user-context':
      return 'User'
    case 'memory':
      return 'Workspace'
    case 'context-files':
    case 'canvas-snapshot':
    case 'app-builder':
      return 'This turn'
    case 'profile-coach':
    case 'profile-state':
      return 'Profile'
    default:
      return 'Core'
  }
}

/** Short guide shown above the system section list in the context manager. */
export const MODEL_CONTEXT_SECTION_ORDER_HELP: { title: string; items: string[] } =
  {
    title: 'How system sections are ordered',
    items: [
      'Core — Routing: numbered decision tree (document vs code mode) plus mode-specific rules.',
      'Skills — create-skill body (always) and the skills catalog (metadata for `.braian/skills/*.md`).',
      'User — Profile and automatic client time (sidebar → You).',
      'Workspace — Durable MEMORY.md for this folder.',
      'This turn — Attached files, document canvas snapshot, and (when App mode is on) full dashboard builder instructions from the app-builder skill.',
    ],
  }
