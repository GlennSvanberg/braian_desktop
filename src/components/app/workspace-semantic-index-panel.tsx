import { useCallback, useEffect, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  retrievalIndexStatus,
} from '@/lib/retrieval/retrieval-api'
import { rebuildWorkspaceSemanticIndexFull } from '@/lib/retrieval/workspace-indexer'
import { isTauri } from '@/lib/tauri-env'

type Props = {
  workspaceId: string
}

export function WorkspaceSemanticIndexPanel({ workspaceId }: Props) {
  const [status, setStatus] = useState<{
    chunkCount: number
    sourceCount: number
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!isTauri()) return
    try {
      const s = await retrievalIndexStatus(workspaceId)
      setStatus({ chunkCount: s.chunkCount, sourceCount: s.sourceCount })
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [workspaceId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const onRebuild = async () => {
    setBusy(true)
    setError(null)
    try {
      await rebuildWorkspaceSemanticIndexFull(workspaceId)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (!isTauri()) return null

  return (
    <div className="border-border space-y-3 rounded-xl border p-4 shadow-sm">
      <div>
        <h2 className="text-text-1 text-base font-semibold tracking-tight">
          Semantic workspace index
        </h2>
        <p className="text-text-3 mt-1 text-sm leading-relaxed">
          Indexes workspace files (excluding secrets like <code className="text-text-2 text-xs">.env</code>),
          chat transcripts under <code className="text-text-2 text-xs">.braian/conversations</code>, and
          structured memory. Embeddings use your AI provider settings (see global AI settings). After
          changing embedding models, rebuild here.
        </p>
      </div>
      {status ? (
        <p className="text-text-2 text-sm">
          Indexed chunks: <strong>{status.chunkCount}</strong> · Sources:{' '}
          <strong>{status.sourceCount}</strong>
        </p>
      ) : (
        <p className="text-text-3 text-sm">Loading index status…</p>
      )}
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
      <Button
        type="button"
        variant="secondary"
        disabled={busy}
        onClick={() => void onRebuild()}
        className="gap-2"
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <RefreshCw className="size-4" aria-hidden />
        )}
        Rebuild semantic index
      </Button>
    </div>
  )
}
