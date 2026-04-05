import { toolDefinition } from '@tanstack/ai'
import { z } from 'zod'

import {
  workspaceListDir,
  workspaceReadTextFile,
  workspaceRunCommand,
  workspaceWriteTextFile,
  type WorkspaceDirEntryDto,
  type WorkspaceReadTextFileResult,
} from '@/lib/workspace-api'

import { isNonWorkspaceScopedSessionId } from '@/lib/chat-sessions/detached'

import type { ChatTurnContext } from './types'

/** Names of workspace file/command tools (lazy in document mode, eager in code mode). */
export const WORKSPACE_CODE_TOOL_NAMES = [
  'read_workspace_file',
  'write_workspace_file',
  'list_workspace_dir',
  'run_workspace_command',
] as const

const CODE_TOOL_NAME_SET = new Set<string>([...WORKSPACE_CODE_TOOL_NAMES])

/** True when a `__lazy__tool__discovery__` tool result exposes at least one workspace code tool. */
export function discoveryResultIncludesCodeTools(
  result: string | undefined,
): boolean {
  if (result == null || result.trim() === '') return false
  let parsed: unknown
  try {
    parsed = JSON.parse(result) as unknown
  } catch {
    return false
  }
  if (!parsed || typeof parsed !== 'object') return false
  const tools = (parsed as { tools?: unknown }).tools
  if (!Array.isArray(tools)) return false
  for (const t of tools) {
    if (
      t &&
      typeof t === 'object' &&
      typeof (t as { name?: string }).name === 'string' &&
      CODE_TOOL_NAME_SET.has((t as { name: string }).name)
    ) {
      return true
    }
  }
  return false
}

const readWorkspaceFileSchema = z.object({
  path: z
    .string()
    .describe(
      'File path relative to workspace root (forward slashes, e.g. scripts/foo.py).',
    ),
  maxBytes: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Optional max bytes to read (default ~512 KiB, cap 2 MiB).'),
})

const writeWorkspaceFileSchema = z.object({
  path: z
    .string()
    .describe(
      'File path relative to workspace root. Parent directories are created if needed.',
    ),
  content: z.string().describe('Full UTF-8 file content to write.'),
})

const listWorkspaceDirSchema = z.object({
  path: z
    .string()
    .optional()
    .describe(
      'Directory relative to workspace root; omit or empty string for workspace root.',
    ),
})

const runCommandSchema = z.object({
  program: z
    .string()
    .describe(
      'Executable name or path (e.g. python, py, powershell.exe, pwsh). No shell — use argv only.',
    ),
  args: z
    .array(z.string())
    .describe('Arguments passed verbatim (e.g. ["-3", "scripts/run.py"]).'),
  cwd: z
    .string()
    .optional()
    .describe(
      'Working directory relative to workspace root; default is workspace root.',
    ),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Optional timeout in ms (default 120000, max 600000).'),
})

export type BuildCodingToolsOptions = {
  /** When true, tools are hidden until the model calls `__lazy__tool__discovery__`. */
  lazy?: boolean
}

export function buildCodingTools(
  context: ChatTurnContext | undefined,
  options?: BuildCodingToolsOptions,
) {
  if (
    !context?.workspaceId ||
    isNonWorkspaceScopedSessionId(context.workspaceId)
  ) {
    return []
  }

  const lazy = options?.lazy ?? false
  const workspaceId = context.workspaceId

  const readWorkspaceFileTool = toolDefinition({
    name: 'read_workspace_file',
    description:
      'Read a UTF-8 text file under the workspace. Fails on binary-only content.',
    inputSchema: readWorkspaceFileSchema,
    lazy,
  })

  const writeWorkspaceFileTool = toolDefinition({
    name: 'write_workspace_file',
    description:
      'Write or overwrite a UTF-8 file under the workspace. Creates parent directories.',
    inputSchema: writeWorkspaceFileSchema,
    lazy,
  })

  const listWorkspaceDirTool = toolDefinition({
    name: 'list_workspace_dir',
    description:
      'List files and subdirectories in one directory (non-recursive).',
    inputSchema: listWorkspaceDirSchema,
    lazy,
  })

  const runCommandTool = toolDefinition({
    name: 'run_workspace_command',
    description:
      'Run a program with argv (no shell). Stdout and stderr are captured; very large output may be truncated.',
    inputSchema: runCommandSchema,
    lazy,
  })

  return [
    readWorkspaceFileTool.server(async (args) => {
      const input = readWorkspaceFileSchema.parse(args)
      try {
        const result: WorkspaceReadTextFileResult =
          await workspaceReadTextFile(
            workspaceId,
            input.path,
            input.maxBytes ?? null,
          )
        return {
          ok: true as const,
          truncated: result.truncated,
          text: result.text,
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return { ok: false as const, error: msg }
      }
    }),
    writeWorkspaceFileTool.server(async (args) => {
      const input = writeWorkspaceFileSchema.parse(args)
      try {
        await workspaceWriteTextFile(
          workspaceId,
          input.path,
          input.content,
        )
        return { ok: true as const, path: input.path }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return { ok: false as const, error: msg }
      }
    }),
    listWorkspaceDirTool.server(async (args) => {
      const input = listWorkspaceDirSchema.parse(args)
      try {
        const entries: WorkspaceDirEntryDto[] = await workspaceListDir(
          workspaceId,
          input.path?.trim() ?? '',
        )
        return { ok: true as const, entries }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return { ok: false as const, error: msg }
      }
    }),
    runCommandTool.server(async (args) => {
      const input = runCommandSchema.parse(args)
      try {
        const result = await workspaceRunCommand({
          workspaceId,
          program: input.program,
          args: input.args,
          cwd: input.cwd ?? null,
          timeoutMs: input.timeoutMs ?? null,
        })
        return { ok: true as const, ...result }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return { ok: false as const, error: msg }
      }
    }),
  ]
}
