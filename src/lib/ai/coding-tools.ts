import { toolDefinition } from '@tanstack/ai'
import { z } from 'zod'

import {
  workspaceListDir,
  workspaceReadTextFile,
  workspaceRunCommand,
  workspaceRunShell,
  workspaceSearchText,
  workspaceWriteTextFile,
  type WorkspaceDirEntryDto,
  type WorkspaceReadTextFileResult,
  type WorkspaceSearchResult,
} from '@/lib/workspace-api'

import { applyTextPatches } from './text-patches'

import { isNonWorkspaceScopedSessionId } from '@/lib/chat-sessions/detached'

import type { ChatTurnContext } from './types'

/** Names of workspace file/command tools (lazy in document mode, eager in code mode). */
export const WORKSPACE_CODE_TOOL_NAMES = [
  'read_workspace_file',
  'write_workspace_file',
  'patch_workspace_file',
  'list_workspace_dir',
  'search_workspace',
  'run_workspace_command',
  'run_workspace_shell',
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

const runShellSchema = z.object({
  command: z
    .string()
    .describe(
      'Shell command string. Windows: runs via cmd.exe /C. Unix: runs via sh -c. Pipes, redirects, chaining (&&, ||) all work.',
    ),
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

const searchWorkspaceSchema = z.object({
  query: z.string().describe('Text to search for across workspace files.'),
  fileGlob: z
    .string()
    .optional()
    .describe(
      'Optional glob filter (e.g. "*.ts", "*.py"). Omit to search all text files.',
    ),
  caseInsensitive: z
    .boolean()
    .optional()
    .describe('Case-insensitive search. Default: false (case-sensitive).'),
  maxResults: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Max matches to return (default 100, cap 200).'),
})

const patchReplacementSchema = z.object({
  find: z
    .string()
    .describe(
      'Exact substring to find in the file. Must be unique unless replaceAll is true.',
    ),
  replace: z
    .string()
    .describe('Replacement text (may be empty to delete).'),
  replaceAll: z
    .boolean()
    .optional()
    .describe(
      'If true, replace every non-overlapping occurrence. Default: require a single match.',
    ),
})

const patchWorkspaceFileSchema = z.object({
  path: z
    .string()
    .describe('File path relative to workspace root.'),
  replacements: z
    .array(patchReplacementSchema)
    .min(1)
    .describe(
      'Ordered list of find/replace steps applied sequentially to the file content.',
    ),
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

  const runShellTool = toolDefinition({
    name: 'run_workspace_shell',
    description:
      'Run a shell command string under the workspace. Supports pipes, redirects, chaining (&&, ||), and environment variables. Stdout and stderr are captured.',
    inputSchema: runShellSchema,
    lazy,
  })

  const searchWorkspaceTool = toolDefinition({
    name: 'search_workspace',
    description:
      'Search for text across all files in the workspace (recursive). Returns matching lines with file paths and line numbers.',
    inputSchema: searchWorkspaceSchema,
    lazy,
  })

  const patchWorkspaceFileTool = toolDefinition({
    name: 'patch_workspace_file',
    description:
      'Apply targeted find/replace edits to an existing file. Each replacement runs in order on the result of the previous step. Prefer over write_workspace_file for small changes to large files.',
    inputSchema: patchWorkspaceFileSchema,
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
    runShellTool.server(async (args) => {
      const input = runShellSchema.parse(args)
      try {
        const result = await workspaceRunShell({
          workspaceId,
          command: input.command,
          cwd: input.cwd ?? null,
          timeoutMs: input.timeoutMs ?? null,
        })
        return { ok: true as const, ...result }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return { ok: false as const, error: msg }
      }
    }),
    searchWorkspaceTool.server(async (args) => {
      const input = searchWorkspaceSchema.parse(args)
      try {
        const result: WorkspaceSearchResult = await workspaceSearchText({
          workspaceId,
          query: input.query,
          fileGlob: input.fileGlob ?? null,
          caseInsensitive: input.caseInsensitive ?? null,
          maxResults: input.maxResults ?? null,
        })
        return { ok: true as const, ...result }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return { ok: false as const, error: msg }
      }
    }),
    patchWorkspaceFileTool.server(async (args) => {
      const input = patchWorkspaceFileSchema.parse(args)
      try {
        const file = await workspaceReadTextFile(
          workspaceId,
          input.path,
          null,
        )
        const patched = applyTextPatches(file.text, input.replacements)
        if (!patched.ok) {
          return { ok: false as const, error: patched.error, code: patched.code }
        }
        await workspaceWriteTextFile(workspaceId, input.path, patched.text)
        return { ok: true as const, path: input.path }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return { ok: false as const, error: msg }
      }
    }),
  ]
}
