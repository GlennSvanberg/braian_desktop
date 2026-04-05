import { toolDefinition } from '@tanstack/ai'
import { invoke } from '@tauri-apps/api/core'
import { z } from 'zod'

import { chatSessionKey } from '@/lib/chat-sessions/keys'
import { getThreadSnapshot } from '@/lib/chat-sessions/store'

import { applyDocumentCanvasPatches } from './document-canvas-patch'
import { getDocumentCanvasLivePayload } from './document-canvas-live'
import type { ChatTurnContext } from './types'

const replacementSchema = z.object({
  find: z
    .string()
    .describe(
      'Exact substring to find in the current canvas markdown (from the snapshot / live editor). Must be unique unless replaceAll is true.',
    ),
  replace: z.string().describe('Replacement text (may be empty to delete).'),
  replaceAll: z
    .boolean()
    .optional()
    .describe(
      'If true, replace every non-overlapping occurrence of find in the document for this step. Default: require a single match.',
    ),
})

const applyDocumentCanvasPatchInputSchema = z.object({
  baseRevision: z
    .number()
    .int()
    .describe(
      'Document canvas revision from the snapshot for this turn. Must match the current revision or the patch will be rejected.',
    ),
  replacements: z
    .array(replacementSchema)
    .min(1)
    .describe('Ordered list of find/replace steps applied to the current canvas.'),
  title: z
    .string()
    .optional()
    .describe('Optional canvas title; only set when the user asked to rename the document.'),
})

const openDocumentCanvasInputSchema = z.object({
  markdown: z
    .string()
    .describe(
      'Complete markdown for the document canvas. Use only when restructuring the entire document or when apply_document_canvas_patch is impractical.',
    ),
  title: z
    .string()
    .optional()
    .describe('Optional short title for the canvas document.'),
})

const applyDocumentCanvasPatchTool = toolDefinition({
  name: 'apply_document_canvas_patch',
  description: `Update the side-panel document canvas with targeted find/replace steps (preferred). Uses the latest canvas markdown and revision from the system prompt snapshot. Each replacement runs in order on the result of the previous step. Preserve text outside the edited spans. If the user selected text in the canvas (section-only context), limit changes to that region. On revision mismatch or ambiguous matches, fix find strings and retry.`,
  inputSchema: applyDocumentCanvasPatchInputSchema,
})

const openDocumentCanvasTool = toolDefinition({
  name: 'open_document_canvas',
  description: `Replace the entire document canvas markdown in one shot. Prefer **apply_document_canvas_patch** for most edits. Use full rewrite only for large restructuring, new documents, or when patch steps would be unwieldy.`,
  inputSchema: openDocumentCanvasInputSchema,
})

function sessionKeyFromContext(context: ChatTurnContext): string {
  return chatSessionKey(context.workspaceId, context.conversationId)
}

function resolveDocumentCanvasForTool(sessionKey: string):
  | {
      ok: true
      body: string
      revision: number
      title: string | undefined
    }
  | { ok: false; error: string } {
  const thread = getThreadSnapshot(sessionKey)
  const p = thread.artifactPayload
  if (!p || p.kind !== 'document') {
    return {
      ok: false,
      error: 'No document canvas is open for this conversation.',
    }
  }
  const live = getDocumentCanvasLivePayload(sessionKey)
  const body = live?.body ?? p.body
  const revision = p.canvasRevision ?? 0
  const title = p.title
  return { ok: true, body, revision, title }
}

export function buildCanvasTools(context: ChatTurnContext | undefined) {
  if (
    context?.conversationId == null ||
    context.conversationId === ''
  ) {
    return []
  }

  const workspaceId = context.workspaceId
  const conversationId = context.conversationId
  const sessionKey = sessionKeyFromContext(context)

  return [
    applyDocumentCanvasPatchTool.server(async (args, toolCtx) => {
      const input = applyDocumentCanvasPatchInputSchema.parse(args)
      const resolved = resolveDocumentCanvasForTool(sessionKey)
      if (!resolved.ok) {
        return { ok: false as const, error: resolved.error }
      }
      if (input.baseRevision !== resolved.revision) {
        return {
          ok: false as const,
          error: `Canvas revision mismatch: current ${resolved.revision}, tool had ${input.baseRevision}. Read the latest snapshot and retry with updated find strings and baseRevision.`,
        }
      }

      const applied = applyDocumentCanvasPatches(resolved.body, input.replacements)
      if (!applied.ok) {
        return { ok: false as const, error: applied.error }
      }

      const nextRevision = resolved.revision + 1
      const nextTitle = input.title ?? resolved.title

      try {
        await invoke('canvas_document_write', {
          input: {
            workspaceId,
            conversationId,
            markdown: applied.markdown,
            title: nextTitle ?? null,
          },
        })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return { ok: false as const, error: msg }
      }

      toolCtx?.emitCustomEvent('braian-artifact', {
        kind: 'document',
        body: applied.markdown,
        ...(nextTitle !== undefined && nextTitle !== ''
          ? { title: nextTitle }
          : {}),
        canvasRevision: nextRevision,
      })

      return {
        ok: true as const,
        message:
          'Canvas updated with targeted edits. Reply briefly in chat; the document is in the side panel.',
      }
    }),

    openDocumentCanvasTool.server(async (args, toolCtx) => {
      const input = openDocumentCanvasInputSchema.parse(args)
      const thread = getThreadSnapshot(sessionKey)
      const p = thread.artifactPayload
      const nextRevision =
        p?.kind === 'document' ? (p.canvasRevision ?? 0) + 1 : 1
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
        canvasRevision: nextRevision,
      })

      return {
        ok: true as const,
        message:
          'Canvas updated. Reply briefly in chat; the document is in the side panel.',
      }
    }),
  ]
}
