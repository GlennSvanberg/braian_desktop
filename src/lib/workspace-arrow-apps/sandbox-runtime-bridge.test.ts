import { describe, expect, it } from 'vitest'

import {
  formatArrowSandboxErrorsForSystem,
  reportArrowSandboxRuntimeError,
  takePendingArrowSandboxErrorsForChat,
} from '@/lib/workspace-arrow-apps/sandbox-runtime-bridge'

describe('sandbox-runtime-bridge', () => {
  it('queues, formats, and consumes errors per workspace', () => {
    reportArrowSandboxRuntimeError({
      workspaceId: 'ws-1',
      appId: 'demo',
      phase: 'compile',
      message: 'bad import',
    })
    reportArrowSandboxRuntimeError({
      workspaceId: 'ws-2',
      appId: 'other',
      phase: 'runtime',
      message: 'boom',
    })
    const a = takePendingArrowSandboxErrorsForChat('ws-1')
    expect(a).toHaveLength(1)
    expect(a[0].message).toBe('bad import')
    expect(takePendingArrowSandboxErrorsForChat('ws-1')).toHaveLength(0)

    const b = takePendingArrowSandboxErrorsForChat('ws-2')
    expect(b).toHaveLength(1)
    expect(formatArrowSandboxErrorsForSystem(b)).toContain('boom')
    expect(takePendingArrowSandboxErrorsForChat('ws-2')).toHaveLength(0)
  })

  it('dedupes identical errors within the window', () => {
    reportArrowSandboxRuntimeError({
      workspaceId: 'ws-d',
      appId: 'x',
      phase: 'runtime',
      message: 'same',
    })
    reportArrowSandboxRuntimeError({
      workspaceId: 'ws-d',
      appId: 'x',
      phase: 'runtime',
      message: 'same',
    })
    const taken = takePendingArrowSandboxErrorsForChat('ws-d')
    expect(taken).toHaveLength(1)
  })
})
