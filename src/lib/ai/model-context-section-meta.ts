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
    case 'skills-catalog':
      return 'Skills'
    case 'user-context':
      return 'User'
    case 'memory':
      return 'Workspace'
    case 'context-files':
    case 'context-prior-conversations':
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
      'Core — Routing: decision tree (document vs code mode) plus mode-specific rules.',
      'Skills — Catalog of `.braian/skills/*.md` (metadata only; full bodies loaded on demand).',
      'User — Profile and automatic client time.',
      'Workspace — Durable MEMORY.md.',
      'This turn — Attached files, prior conversation transcripts, document canvas snapshot, and (when App mode is on) dashboard builder instructions.',
    ],
  }
