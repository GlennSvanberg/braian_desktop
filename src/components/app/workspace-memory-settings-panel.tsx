import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  MEMORY_RELATIVE_PATH,
  MEMORY_REVIEW_READ_MAX_BYTES,
} from '@/lib/memory/constants'
import {
  workspaceReadTextFile,
  workspaceWriteTextFile,
} from '@/lib/workspace-api'

type Props = {
  workspaceId: string
}

export function WorkspaceMemorySettingsPanel({ workspaceId }: Props) {
  const [text, setText] = useState('')
  const [loadedFromDisk, setLoadedFromDisk] = useState('')
  const [loadState, setLoadState] = useState<'idle' | 'loading'>('idle')
  const [saving, setSaving] = useState(false)
  const [saveHint, setSaveHint] = useState<string | null>(null)

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

  return (
    <div className="border-border space-y-3 rounded-xl border p-4 shadow-sm md:p-5">
      <div>
        <h2 className="text-text-1 text-base font-semibold tracking-tight">
          Workspace memory
        </h2>
        <p className="text-text-3 mt-1 text-sm leading-relaxed">
          Markdown stored at{' '}
          <code className="text-text-2 text-xs">{MEMORY_RELATIVE_PATH}</code>.
          The agent sees this in every chat for this workspace. You can also use
          <span className="text-text-2 font-medium"> Update memory</span> in
          chat or automatic idle updates; manual edits here are always allowed.
        </p>
        {loadState === 'loading' ? (
          <p className="text-text-3 mt-2 flex items-center gap-2 text-xs">
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            Loading…
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
