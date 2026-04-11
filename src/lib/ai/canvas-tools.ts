import { toolDefinition } from '@tanstack/ai'
import { invoke } from '@tauri-apps/api/core'
import { z } from 'zod'

import { chatSessionKey } from '@/lib/chat-sessions/keys'
import {
  canvasLiveScopeKey,
  getActiveArtifactPayload,
} from '@/lib/chat-sessions/artifact-tabs'
import { getThreadSnapshot } from '@/lib/chat-sessions/store'

import { coerceTabularCellValue } from './braian-artifact-from-custom'
import { applyDocumentCanvasPatches } from './document-canvas-patch'
import { getDocumentCanvasLivePayload } from './document-canvas-live'
import { getWorkspaceFileCanvasLivePayload } from './workspace-file-canvas-live'
import { emitWorkspaceDurableActivity } from '@/lib/workspace/workspace-activity'
import { workspaceWriteTextFile } from '@/lib/workspace-api'

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

const applyWorkspaceFileCanvasPatchInputSchema = z.object({
  baseRevision: z
    .number()
    .int()
    .describe(
      'Workspace file canvas revision from the snapshot for this turn. Must match the current revision or the patch will be rejected.',
    ),
  replacements: z
    .array(replacementSchema)
    .min(1)
    .describe(
      'Ordered list of find/replace steps applied to the current file text.',
    ),
  title: z
    .string()
    .optional()
    .describe(
      'Optional label shown in the side panel; only set when the user asked to rename the tab.',
    ),
})

const openWorkspaceFileCanvasInputSchema = z.object({
  relativePath: z
    .string()
    .describe('File path relative to the workspace root (forward slashes).'),
  text: z
    .string()
    .describe(
      'Complete UTF-8 file contents. Use when replacing the whole file or when apply_workspace_file_patch is impractical.',
    ),
  title: z
    .string()
    .optional()
    .describe('Optional short label in the side panel (e.g. basename).'),
})

const tabularColumnSchema = z.object({
  id: z.string().describe('Column identifier (used as row key).'),
  label: z.string().describe('Column header label.'),
  type: z
    .enum(['string', 'number', 'date', 'boolean'])
    .optional()
    .describe('Optional type hint for formatting.'),
})

const applyTabularCanvasInputSchema = z.object({
  columns: z
    .array(tabularColumnSchema)
    .min(1)
    .describe('Column definitions for the table.'),
  rowsJson: z
    .string()
    .describe('JSON-encoded array of row objects keyed by column id. Example: [{"name":"Alice","age":30},{"name":"Bob","age":25}]. Values may be string, number, boolean, or null.'),
  title: z.string().optional().describe('Optional title for the data canvas.'),
  sourceLabel: z
    .string()
    .optional()
    .describe('Optional source label (e.g. "from Budget.xlsx").'),
})

/** Keeps UI + Tauri save payloads from exhausting memory or IPC limits. */
const TABULAR_CANVAS_MAX_ROWS = 25_000

const applyVisualCanvasInputSchema = z.object({
  title: z.string().optional().describe('Optional title for the visual.'),
  prompt: z
    .string()
    .optional()
    .describe('The prompt or description that produced the image.'),
  imageSrc: z
    .string()
    .optional()
    .describe('Image URL or data:image/...;base64,... string.'),
  alt: z.string().optional().describe('Alt text for the image.'),
})

const applyDocumentCanvasPatchTool = toolDefinition({
  name: 'apply_document_canvas_patch',
  description:
    'Update the side-panel document canvas with targeted find/replace steps. Each replacement runs in order on the result of the previous step.',
  inputSchema: applyDocumentCanvasPatchInputSchema,
})

const openDocumentCanvasTool = toolDefinition({
    name: 'open_document_canvas',
    description:
      'Replace the entire document canvas markdown in one shot. Use for full rewrites or new documents.',
    inputSchema: openDocumentCanvasInputSchema,
  })

const applyWorkspaceFileCanvasPatchTool = toolDefinition({
  name: 'apply_workspace_file_patch',
  description:
    'Update the open workspace text file in the side panel with targeted find/replace steps. Writes to disk under the workspace. Each replacement runs in order on the result of the previous step.',
  inputSchema: applyWorkspaceFileCanvasPatchInputSchema,
})

const openWorkspaceFileCanvasTool = toolDefinition({
  name: 'open_workspace_file_canvas',
  description:
    'Replace an entire workspace file’s contents in one shot (side panel + disk). Use for new files or full rewrites.',
  inputSchema: openWorkspaceFileCanvasInputSchema,
})

const applyTabularCanvasTool = toolDefinition({
  name: 'apply_tabular_canvas',
  description:
    'Display structured tabular data in the side-panel data canvas. Replaces any current canvas content with a table view.',
  inputSchema: applyTabularCanvasInputSchema,
})

const applyVisualCanvasTool = toolDefinition({
  name: 'apply_visual_canvas',
  description:
    'Display a visual (image) in the side-panel visual canvas. Use for generated images, charts rendered to image, or visual content.',
  inputSchema: applyVisualCanvasInputSchema,
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
  const p = getActiveArtifactPayload(thread)
  if (!p || p.kind !== 'document') {
    return {
      ok: false,
      error: 'No document canvas is open in the active side-panel tab.',
    }
  }
  const scope = canvasLiveScopeKey(
    sessionKey,
    thread.activeArtifactTabId,
  )
  const live = getDocumentCanvasLivePayload(scope)
  const body = live?.body ?? p.body
  const revision = p.canvasRevision ?? 0
  const title = p.title
  return { ok: true, body, revision, title }
}

function resolveWorkspaceFileCanvasForTool(sessionKey: string):
  | {
      ok: true
      body: string
      revision: number
      relativePath: string
      title: string | undefined
      truncated: boolean | undefined
    }
  | { ok: false; error: string } {
  const thread = getThreadSnapshot(sessionKey)
  const p = getActiveArtifactPayload(thread)
  if (!p || p.kind !== 'workspace-file') {
    return {
      ok: false,
      error:
        'No workspace file is open in the active side-panel tab for this conversation.',
    }
  }
  const scope = canvasLiveScopeKey(
    sessionKey,
    thread.activeArtifactTabId,
  )
  const live = getWorkspaceFileCanvasLivePayload(scope)
  const body = live?.body ?? p.body
  const revision = p.canvasRevision ?? 0
  return {
    ok: true,
    body,
    revision,
    relativePath: p.relativePath,
    title: p.title,
    truncated: p.truncated,
  }
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

      emitWorkspaceDurableActivity(workspaceId)

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
      const p = getActiveArtifactPayload(thread)
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

      emitWorkspaceDurableActivity(workspaceId)

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

    applyTabularCanvasTool.server(async (args, toolCtx) => {
      try {
        const input = applyTabularCanvasInputSchema.parse(args)
        let rows: Record<string, unknown>[]
        try {
          rows = JSON.parse(input.rowsJson) as Record<string, unknown>[]
        } catch {
          return { ok: false as const, error: 'rowsJson is not valid JSON.' }
        }
        if (!Array.isArray(rows)) {
          return { ok: false as const, error: 'rowsJson must encode a JSON array.' }
        }
        if (rows.length > TABULAR_CANVAS_MAX_ROWS) {
          return {
            ok: false as const,
            error: `Too many rows (${rows.length}). Maximum is ${TABULAR_CANVAS_MAX_ROWS}. Summarize or split the data.`,
          }
        }
        const normalizedRows: Record<string, string | number | boolean | null>[] = []
        for (const row of rows) {
          if (!row || typeof row !== 'object' || Array.isArray(row)) {
            return {
              ok: false as const,
              error: 'rowsJson must be an array of objects (one object per row).',
            }
          }
          const o = row as Record<string, unknown>
          const out: Record<string, string | number | boolean | null> = {}
          for (const k of Object.keys(o)) {
            out[k] = coerceTabularCellValue(o[k])
          }
          normalizedRows.push(out)
        }
        toolCtx?.emitCustomEvent('braian-artifact', {
          kind: 'tabular',
          columns: input.columns,
          rows: normalizedRows,
          ...(input.title ? { title: input.title } : {}),
          ...(input.sourceLabel ? { sourceLabel: input.sourceLabel } : {}),
        })
        return {
          ok: true as const,
          message:
            'Data canvas updated. Reply briefly in chat; the table is in the side panel.',
        }
      } catch (e) {
        console.error('[braian] apply_tabular_canvas', e)
        const msg = e instanceof Error ? e.message : String(e)
        return { ok: false as const, error: msg }
      }
    }),

    applyVisualCanvasTool.server(async (args, toolCtx) => {
      const input = applyVisualCanvasInputSchema.parse(args)
      toolCtx?.emitCustomEvent('braian-artifact', {
        kind: 'visual',
        ...(input.title ? { title: input.title } : {}),
        ...(input.prompt ? { prompt: input.prompt } : {}),
        ...(input.imageSrc ? { imageSrc: input.imageSrc } : {}),
        ...(input.alt ? { alt: input.alt } : {}),
      })
      return {
        ok: true as const,
        message:
          'Visual canvas updated. Reply briefly in chat; the image is in the side panel.',
      }
    }),

    applyWorkspaceFileCanvasPatchTool.server(async (args, toolCtx) => {
      const input = applyWorkspaceFileCanvasPatchInputSchema.parse(args)
      const resolved = resolveWorkspaceFileCanvasForTool(sessionKey)
      if (!resolved.ok) {
        return { ok: false as const, error: resolved.error }
      }
      if (input.baseRevision !== resolved.revision) {
        return {
          ok: false as const,
          error: `Workspace file revision mismatch: current ${resolved.revision}, tool had ${input.baseRevision}. Read the latest snapshot and retry with updated find strings and baseRevision.`,
        }
      }

      const applied = applyDocumentCanvasPatches(resolved.body, input.replacements)
      if (!applied.ok) {
        return { ok: false as const, error: applied.error }
      }

      const nextRevision = resolved.revision + 1
      const nextTitle = input.title ?? resolved.title

      try {
        await workspaceWriteTextFile(
          workspaceId,
          resolved.relativePath,
          applied.markdown,
        )
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return { ok: false as const, error: msg }
      }

      toolCtx?.emitCustomEvent('braian-artifact', {
        kind: 'workspace-file',
        relativePath: resolved.relativePath,
        body: applied.markdown,
        ...(resolved.truncated === true ? { truncated: true } : {}),
        ...(nextTitle !== undefined && nextTitle !== ''
          ? { title: nextTitle }
          : {}),
        canvasRevision: nextRevision,
      })

      return {
        ok: true as const,
        message:
          'File updated on disk and in the side panel. Reply briefly in chat.',
      }
    }),

    openWorkspaceFileCanvasTool.server(async (args, toolCtx) => {
      const input = openWorkspaceFileCanvasInputSchema.parse(args)
      const thread = getThreadSnapshot(sessionKey)
      const p = getActiveArtifactPayload(thread)
      const sameOpen =
        p?.kind === 'workspace-file' && p.relativePath === input.relativePath
      const nextRevision = sameOpen ? (p.canvasRevision ?? 0) + 1 : 1
      try {
        await workspaceWriteTextFile(
          workspaceId,
          input.relativePath,
          input.text,
        )
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return { ok: false as const, error: msg }
      }

      toolCtx?.emitCustomEvent('braian-artifact', {
        kind: 'workspace-file',
        relativePath: input.relativePath,
        body: input.text,
        ...(input.title ? { title: input.title } : {}),
        canvasRevision: nextRevision,
      })

      return {
        ok: true as const,
        message:
          'File written to disk and shown in the side panel. Reply briefly in chat.',
      }
    }),
  ]
}
