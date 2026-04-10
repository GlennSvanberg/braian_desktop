import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'

import { useWorkspace } from '@/components/app/workspace-context'
import { Button } from '@/components/ui/button'
import {
  MEMORY_RELATIVE_PATH,
  MEMORY_REVIEW_READ_MAX_BYTES,
} from '@/lib/memory/constants'
import { runMemoryReviewFromConversationDisk } from '@/lib/memory/review-from-disk'
import {
  workspaceReadTextFile,
  workspaceWriteTextFile,
} from '@/lib/workspace-api'

type Props = {
  workspaceId: string
}

export function WorkspaceMemorySettingsPanel({ workspaceId }: Props) {
  const { conversationsByWorkspace } = useWorkspace()
  const [text, setText] = useState('')
  const [loadedFromDisk, setLoadedFromDisk] = useState('')
  const [loadState, setLoadState] = useState<'idle' | 'loading'>('idle')
  const [saving, setSaving] = useState(false)
  const [saveHint, setSaveHint] = useState<string | null>(null)
  const [mergeConversationId, setMergeConversationId] = useState('')
  const [mergeBusy, setMergeBusy] = useState(false)
  const [mergeHint, setMergeHint] = useState<string | null>(null)

  const conversationsSorted = useMemo(() => {
    const list = conversationsByWorkspace[workspaceId] ?? []
    return [...list].sort((a, b) => b.updatedAtMs - a.updatedAtMs)
  }, [conversationsByWorkspace, workspaceId])

  useEffect(() => {
    setMergeConversationId((prev) => {
      if (prev && conversationsSorted.some((c) => c.id === prev)) return prev
      return conversationsSorted[0]?.id ?? ''
    })
  }, [conversationsSorted])

  const load = useCallback(async () => {
    setLoadState('loading')
    try {
      const r = await workspaceReadTextFile(
        workspaceId,
        MEMORY_RELATIVE_PATH,
        MEMORY_REVIEW_READ_MAX_BYTES,
      )
      const t = r.text
      setText(t)
      setLoadedFromDisk(t)
      setLoadState('idle')
    } catch {
      setText('')
      setLoadedFromDisk('')
      setLoadState('idle')
    }
  }, [workspaceId])

  useEffect(() => {
    void load()
  }, [load])

  const dirty = text !== loadedFromDisk

  const onSave = async () => {
    setSaving(true)
    setSaveHint(null)
    try {
      await workspaceWriteTextFile(workspaceId, MEMORY_RELATIVE_PATH, text)
      setLoadedFromDisk(text)
      setSaveHint('Saved.')
    } catch (e) {
      setSaveHint(
        e instanceof Error ? e.message : 'Could not save workspace memory.',
      )
    } finally {
      setSaving(false)
      window.setTimeout(() => setSaveHint(null), 5000)
    }
  }

  const onReload = () => {
    if (dirty && !window.confirm('Discard unsaved edits and reload from disk?')) {
      return
    }
    void load()
  }

  const onMergeFromChat = async () => {
    if (!mergeConversationId) return
    setMergeBusy(true)
    setMergeHint(null)
    try {
      const r = await runMemoryReviewFromConversationDisk(
        workspaceId,
        mergeConversationId,
      )
      if (r.ok && r.skipped) {
        setMergeHint(r.reason)
      } else if (!r.ok) {
        setMergeHint(r.error)
      } else {
        setMergeHint('Memory file updated (.braian/MEMORY.md).')
        void load()
      }
    } catch (e) {
      setMergeHint(
        e instanceof Error ? e.message : 'Memory update failed.',
      )
    } finally {
      setMergeBusy(false)
      window.setTimeout(() => setMergeHint(null), 8000)
    }
  }

  return (
    <div className="border-border space-y-3 rounded-xl border p-4 shadow-sm md:p-5">
      <div>
        <h2 className="text-text-1 text-base font-semibold tracking-tight">
          Workspace memory
        </h2>
        <p className="text-text-3 mt-1 text-sm leading-relaxed">
          Markdown stored at{' '}
          <code className="text-text-2 text-xs">{MEMORY_RELATIVE_PATH}</code>.
          The agent sees this in every chat for this workspace. Merge durable
          facts from a chat below, use automatic idle updates in AI settings,
          or edit the file here; manual edits are always allowed.
        </p>
        {loadState === 'loading' ? (
          <p className="text-text-3 mt-2 flex items-center gap-2 text-xs">
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            Loading…
          </p>
        ) : null}
      </div>

      <div className="border-border bg-muted/15 space-y-2 rounded-lg border p-3">
        <p className="text-text-2 text-sm font-medium">Update from chat (AI)</p>
        <p className="text-text-3 text-xs leading-relaxed">
          Picks the latest messages from the saved chat file on disk (same as
          the former chat toolbar action).
        </p>
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
          <label className="text-text-3 sr-only shrink-0 text-xs" htmlFor="memory-merge-chat">
            Chat to merge from
          </label>
          <select
            id="memory-merge-chat"
            className="border-border bg-background text-text-1 focus-visible:ring-ring min-h-9 min-w-0 flex-1 rounded-md border px-2 py-1.5 text-sm focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
            value={mergeConversationId}
            onChange={(e) => setMergeConversationId(e.target.value)}
            disabled={conversationsSorted.length === 0 || mergeBusy}
          >
            {conversationsSorted.length === 0 ? (
              <option value="">No chats in this workspace</option>
            ) : (
              conversationsSorted.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title.trim() || c.id.slice(0, 8)}
                </option>
              ))
            )}
          </select>
          <Button
            type="button"
            size="sm"
            className="shrink-0"
            disabled={
              mergeBusy ||
              !mergeConversationId ||
              conversationsSorted.length === 0
            }
            onClick={() => void onMergeFromChat()}
          >
            {mergeBusy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : null}
            Update memory
          </Button>
        </div>
        {mergeHint ? (
          <p
            className={
              mergeHint.includes('updated') || mergeHint.includes('No new')
                ? 'text-text-3 text-xs'
                : 'text-destructive text-xs'
            }
          >
            {mergeHint}
          </p>
        ) : null}
      </div>

      <textarea
        className="border-border bg-background text-text-1 focus-visible:ring-ring min-h-[200px] w-full resize-y rounded-lg border p-3 font-mono text-sm leading-relaxed focus-visible:ring-2 focus-visible:outline-none"
        spellCheck={false}
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label="Workspace memory markdown"
        disabled={loadState === 'loading'}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={() => void onSave()}
          disabled={saving || loadState === 'loading' || !dirty}
        >
          {saving ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : null}
          Save
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onReload}
          disabled={loadState === 'loading'}
        >
          Reload from disk
        </Button>
      </div>

      {saveHint ? (
        <p
          className={
            saveHint === 'Saved.' ? 'text-text-3 text-xs' : 'text-destructive text-xs'
          }
        >
          {saveHint}
        </p>
      ) : null}
    </div>
  )
}
