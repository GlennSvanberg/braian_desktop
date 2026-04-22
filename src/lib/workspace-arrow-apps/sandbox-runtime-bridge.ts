/**
 * Captures Arrow sandbox compile/runtime errors from the host UI so the next
 * `buildTanStackChatTurnArgs` turn can inject them into the model system prompt.
 */

export type ArrowSandboxQueuedError = {
  workspaceId: string
  appId: string
  phase: 'compile' | 'runtime'
  message: string
  atMs: number
}

const MAX_QUEUE = 10
const DEDUPE_WINDOW_MS = 2500

const queue: ArrowSandboxQueuedError[] = []

function dedupeAppend(entry: Omit<ArrowSandboxQueuedError, 'atMs'> & { atMs: number }) {
  const last = queue[queue.length - 1]
  if (
    last &&
    last.workspaceId === entry.workspaceId &&
    last.appId === entry.appId &&
    last.phase === entry.phase &&
    last.message === entry.message &&
    entry.atMs - last.atMs < DEDUPE_WINDOW_MS
  ) {
    return
  }
  queue.push(entry)
  while (queue.length > MAX_QUEUE) queue.shift()
}

/**
 * Called from `ArrowWorkspaceSandbox` when compile or VM/runtime errors occur.
 */
export function reportArrowSandboxRuntimeError(
  input: Omit<ArrowSandboxQueuedError, 'atMs'>,
): void {
  dedupeAppend({ ...input, atMs: Date.now() })
}

/**
 * Returns and **removes** all queued errors for this workspace (one shot per
 * model turn so the assistant is not spammed after the issue is fixed).
 */
export function takePendingArrowSandboxErrorsForChat(
  workspaceId: string,
): ArrowSandboxQueuedError[] {
  const taken: ArrowSandboxQueuedError[] = []
  for (let i = queue.length - 1; i >= 0; i--) {
    if (queue[i].workspaceId === workspaceId) {
      taken.push(queue[i])
      queue.splice(i, 1)
    }
  }
  taken.sort((a, b) => a.atMs - b.atMs)
  return taken
}

export function formatArrowSandboxErrorsForSystem(
  entries: ArrowSandboxQueuedError[],
): string | null {
  if (entries.length === 0) return null
  const lines = entries.map((e) => {
    const phase = e.phase === 'compile' ? 'compile/load' : 'runtime'
    return `- **${e.appId}** (${phase}): ${e.message}`
  })
  return (
    'The workspace **Arrow sandbox** (Apps tab / App-mode artifact) hit errors **after your last reply** while mounting or running the app. Treat this as authoritative host feedback — fix `main.ts` / `main.css` (see app-builder skill: `@arrow-js/core`, `export default html`, `@click`).\n\n' +
    lines.join('\n')
  )
}
