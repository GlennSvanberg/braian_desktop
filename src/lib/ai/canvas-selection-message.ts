import type { DocumentCanvasSelectionContext } from '@/lib/ai/types'

/** Max chars of selected markdown embedded in the chat user message. */
const MAX_EXCERPT_CHARS = 8000

/**
 * User message body for a canvas selection turn: makes the target excerpt and
 * instruction unambiguous for the model and in chat history.
 */
export function formatCanvasSelectionUserMessage(
  instruction: string,
  selection: DocumentCanvasSelectionContext,
): string {
  const instr = instruction.trim()
  let excerpt = selection.selectedMarkdown.replace(/\r\n/g, '\n').trimEnd()
  let truncNote = ''
  if (excerpt.length > MAX_EXCERPT_CHARS) {
    excerpt = excerpt.slice(0, MAX_EXCERPT_CHARS)
    truncNote = '\n\n[… excerpt truncated for chat message length]'
  }
  return [
    "**Canvas selection** — apply the instruction **only** to the text in the fenced block below (what was marked in the document). Words like \"this\", \"this part\", \"it\", or \"the selection\" mean **that** text—not the whole document.",
    '',
    '```markdown',
    excerpt + truncNote,
    '```',
    '',
    `**Instruction:** ${instr}`,
  ].join('\n')
}
