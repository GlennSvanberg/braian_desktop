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
  description: `Open the document canvas (workspace side panel) and set its markdown. Use when the user wants long-form text—stories, specs, memos—edited in the canvas, not only in chat. Put the full initial markdown in the tool argument; do not rely on chat alone for the document body.`,
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
