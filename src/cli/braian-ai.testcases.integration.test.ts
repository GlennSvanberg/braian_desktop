/**
 * Maps manual scenarios in testcases.md to checks runnable via the real `braian-ai` CLI
 * (`dump-request`). Full tool execution and disk IO still require `npm run tauri:dev`.
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const tsxCli = join(repoRoot, 'node_modules/tsx/dist/cli.mjs')
const braianAi = join(repoRoot, 'src/cli/braian-ai.ts')

/** Avoid inheriting IDE/Node `--localstorage-file` in NODE_OPTIONS (spurious warnings). */
function envForSubprocess(): NodeJS.ProcessEnv {
  const e = { ...process.env }
  delete e.NODE_OPTIONS
  return e
}

type DumpSnapshot = {
  systemSections: Array<{ id: string; text: string }>
  tools: Array<{ name: string; lazy?: boolean }>
}

function runDumpRequest(
  user: string,
  context: Record<string, unknown>,
): DumpSnapshot {
  const dir = mkdtempSync(join(tmpdir(), 'braian-tc-'))
  const ctxPath = join(dir, 'context.json')
  writeFileSync(ctxPath, JSON.stringify(context), 'utf8')
  try {
    const out = execFileSync(
      process.execPath,
      [
        tsxCli,
        braianAi,
        'dump-request',
        '--user',
        user,
        '--context',
        ctxPath,
        '--allow-incomplete-settings',
      ],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        env: envForSubprocess(),
        maxBuffer: 20 * 1024 * 1024,
      },
    )
    return JSON.parse(out) as DumpSnapshot
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function toolNames(snap: DumpSnapshot): string[] {
  return snap.tools.map((t) => t.name)
}

describe('testcases.md (CLI: braian-ai dump-request)', () => {
  it(
    '§3 Unsaved chat — no open_document_canvas; routing tells model to explain save requirement',
    { timeout: 60_000 },
    () => {
      const snap = runDumpRequest('Put this spec in the workspace document.', {
        workspaceId: 'ws-workspace-folder',
        conversationId: null,
        agentMode: 'document',
      })
      expect(toolNames(snap)).not.toContain('open_document_canvas')
      const routing = snap.systemSections.find((s) => s.id === 'routing-doc')
      expect(routing?.text).toMatch(/Unsaved chat/)
    },
  )

  it(
    '§2 Saved chat — open_document_canvas is registered for a persisted conversation',
    { timeout: 60_000 },
    () => {
      const snap = runDumpRequest('Write a one-page project brief for the app.', {
        workspaceId: 'ws-workspace-folder',
        conversationId: 'persisted-conversation-id',
        agentMode: 'document',
      })
      expect(toolNames(snap)).toContain('open_document_canvas')
    },
  )

  it(
    '§4 Read/summarize files — code mode exposes workspace list/read tools (eager)',
    { timeout: 60_000 },
    () => {
      const snap = runDumpRequest(
        "List what's in src/ and summarize README.md.",
        {
          workspaceId: 'ws-workspace-folder',
          conversationId: 'persisted-conversation-id',
          agentMode: 'code',
        },
      )
      expect(toolNames(snap)).toContain('list_workspace_dir')
      expect(toolNames(snap)).toContain('read_workspace_file')
      const read = snap.tools.find((t) => t.name === 'read_workspace_file')
      expect(read?.lazy).toBeUndefined()
    },
  )

  it(
    '§1 CSV → Excel (prompt shape) — attached CSV in system context; switch_to_code_agent available',
    { timeout: 60_000 },
    () => {
      const snap = runDumpRequest('Turn this into an Excel file.', {
        workspaceId: 'ws-workspace-folder',
        conversationId: 'persisted-conversation-id',
        agentMode: 'document',
        contextFiles: [
          {
            relativePath: 'data/sample.csv',
            text: 'col_a,col_b\n1,2',
          },
        ],
      })
      const cf = snap.systemSections.find((s) => s.id === 'context-files')
      expect(cf).toBeDefined()
      expect(cf?.text).toContain('data/sample.csv')
      expect(toolNames(snap)).toContain('switch_to_code_agent')
    },
  )

  it(
    '§5 MEMORY.md — Node CLI has no Tauri file read; memory block is omitted (desktop verifies injection)',
    { timeout: 60_000 },
    () => {
      const snap = runDumpRequest('What product name should you use?', {
        workspaceId: 'ws-with-memory-on-disk',
        conversationId: 'c1',
        agentMode: 'document',
      })
      expect(snap.systemSections.some((s) => s.id === 'memory')).toBe(false)
    },
  )
})
