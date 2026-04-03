import type { WorkspaceArtifactPayload } from '@/lib/artifacts/types'

/** Minimal canvas when no AI artifact chunk has been emitted yet. */
export function getPlaceholderArtifactPayload(
  canvasKind: 'document' | 'tabular' | 'visual',
  title: string,
): WorkspaceArtifactPayload {
  const t = title.trim() || 'Workspace'
  switch (canvasKind) {
    case 'tabular':
      return {
        kind: 'tabular',
        title: t,
        columns: [
          { id: 'note', label: 'Note' },
        ],
        rows: [
          {
            note: 'Connect data files from your workspace to populate this table.',
          },
        ],
      }
    case 'visual':
      return {
        kind: 'visual',
        title: t,
        alt: 'Visual canvas',
        prompt: undefined,
        imageSrc: undefined,
      }
    case 'document':
    default:
      return {
        kind: 'document',
        title: t,
        body: `# ${t}\n\nUse the chat to work in Braian. Replies appear in the thread; this panel is for long-form notes and future AI-driven documents.\n`,
      }
  }
}
