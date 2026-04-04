import { toolDefinition } from '@tanstack/ai'
import { invoke } from '@tauri-apps/api/core'
import { z } from 'zod'

import type { ChatTurnContext } from './types'

const openDocumentCanvasInputSchema = z.object({
  markdown: z
    .string()
    .describe('Complete markdown for the document canvas.'),
  title: z
    .string()
    .optional()
    .describe('Optional short title for the canvas document.'),
})

const openDocumentCanvasTool = toolDefinition({
  name: 'open_document_canvas',
  description: `Write the document canvas (side panel) markdown to disk and refresh the UI. Always pass the **entire** file content. If a document canvas snapshot was provided in the system prompt for this turn, treat it as the current file: merge the user's request into that text and preserve their manual edits unless they asked to remove them. In coding/data workflows, use the canvas for human-readable previews and reports (e.g. inspection summaries, sample tables); put binary outputs such as .xlsx on disk via scripts, not in the canvas.`,
  inputSchema: openDocumentCanvasInputSchema,
})

export function buildCanvasTools(context: ChatTurnContext | undefined) {
  if (
    context?.conversationId == null ||
    context.conversationId === ''
  ) {
    return []
  }

  const workspaceId = context.workspaceId
  const conversationId = context.conversationId

  return [
    openDocumentCanvasTool.server(async (args, toolCtx) => {
      const input = openDocumentCanvasInputSchema.parse(args)
      try {
        await invoke('canvas_document_write', {
          input: {
            workspaceId,
            conversationId,
            markdown: input.markdown,
            title: input.title ?? null,
          },
        })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return { ok: false as const, error: msg }
      }

      toolCtx?.emitCustomEvent('braian-artifact', {
        kind: 'document',
        body: input.markdown,
        ...(input.title ? { title: input.title } : {}),
      })

      return {
        ok: true as const,
        message:
          'Canvas updated. Reply briefly in chat; the document is in the side panel.',
      }
    }),
  ]
}
