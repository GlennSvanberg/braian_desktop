import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Eye, EyeOff, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  aiSettingsGet,
  aiSettingsSet,
  type AiSettingsDto,
} from '@/lib/ai-settings-api'
import {
  AI_PROVIDERS,
  type AiProviderId,
  defaultModelForProvider,
  modelOptionsForUi,
} from '@/lib/ai/model-catalog'
import {
  memorySettingsGet,
  memorySettingsSet,
} from '@/lib/memory/memory-settings'
import { cn } from '@/lib/utils'

type Props = {
  /** When true, omit the page-level heading block (e.g. embedded under You tabs). */
  embedded?: boolean
  className?: string
}

export function AiSettingsPanel({ embedded, className }: Props) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedOk, setSavedOk] = useState(false)
  const [memoryAutoReview, setMemoryAutoReview] = useState(false)
  const [form, setForm] = useState<AiSettingsDto>({
    provider: 'openai',
    apiKey: '',
    modelId: defaultModelForProvider('openai'),
    baseUrl: null,
  })

  useEffect(() => {
    setMemoryAutoReview(memorySettingsGet().autoReviewOnIdle)
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const s = await aiSettingsGet()
        if (!cancelled) setForm(s)
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const onProviderChange = useCallback((id: string) => {
    const p = id as AiProviderId
    setForm((f) => ({
      ...f,
      provider: p,
      modelId: defaultModelForProvider(p),
      baseUrl: p === 'openai_compatible' ? f.baseUrl : null,
    }))
  }, [])

  const models = modelOptionsForUi(form.provider, form.modelId)

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSavedOk(false)
    setSaving(true)
    void (async () => {
      try {
        await aiSettingsSet(form)
        setSavedOk(true)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setSaving(false)
      }
    })()
  }

  return (
    <div
      className={cn(
        !embedded && 'bg-background flex min-h-0 flex-1 flex-col overflow-auto p-4 md:p-6',
        className,
      )}
    >
      <div
        className={cn(
          'space-y-6',
          embedded ? 'w-full' : 'mx-auto w-full max-w-lg',
        )}
      >
        {!embedded ? (
          <div>
            <h1 className="text-text-1 text-lg font-semibold tracking-tight">
              AI settings
            </h1>
            <p className="text-text-3 mt-1 text-sm leading-relaxed">
              Bring your own API key. Keys are stored locally on this device (SQLite
              in the desktop app, or browser storage in web-only dev).
            </p>
          </div>
        ) : (
          <div>
            <h2 className="text-text-1 text-base font-semibold tracking-tight">
              AI &amp; models
            </h2>
            <p className="text-text-3 mt-1 text-sm leading-relaxed">
              Bring your own API key. Keys stay on this device.
            </p>
          </div>
        )}

        {loading ? (
          <div className="text-text-3 flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Loading…
          </div>
        ) : (
          <form
            onSubmit={onSubmit}
            className="border-border space-y-5 rounded-xl border p-4 shadow-sm md:p-5"
          >
            <div className="space-y-2">
              <label
                htmlFor="ai-provider"
                className="text-text-2 text-sm font-medium"
              >
                Provider
              </label>
              <select
                id="ai-provider"
                className={cn(
                  'border-border bg-background text-text-1 focus-visible:ring-ring h-10 w-full rounded-md border px-3 text-sm',
                  'focus-visible:ring-2 focus-visible:outline-none',
                )}
                value={form.provider}
                onChange={(e) => onProviderChange(e.target.value)}
              >
                {AI_PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            {form.provider === 'openai_compatible' ? (
              <div className="space-y-2">
                <label
                  htmlFor="ai-base-url"
                  className="text-text-2 text-sm font-medium"
                >
                  Base URL
                </label>
                <Input
                  id="ai-base-url"
                  placeholder="https://api.x.ai/v1"
                  value={form.baseUrl ?? ''}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      baseUrl: e.target.value.trim() || null,
                    }))
                  }
                  autoComplete="off"
                />
                <p className="text-text-3 text-xs leading-relaxed">
                  OpenAI-compatible chat completions API (often ends with{' '}
                  <code className="text-text-2">/v1</code>). Add the host under
                  Tauri HTTP permissions if it is not already allowed.
                </p>
              </div>
            ) : null}

            <div className="space-y-2">
              <label
                htmlFor="ai-model"
                className="text-text-2 text-sm font-medium"
              >
                Model
              </label>
              {form.provider === 'openai_compatible' ? (
                <Input
                  id="ai-model"
                  placeholder="e.g. grok-3"
                  value={form.modelId}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, modelId: e.target.value }))
                  }
                  autoComplete="off"
                />
              ) : (
                <select
                  id="ai-model"
                  className={cn(
                    'border-border bg-background text-text-1 focus-visible:ring-ring h-10 w-full rounded-md border px-3 text-sm',
                    'focus-visible:ring-2 focus-visible:outline-none',
                  )}
                  value={form.modelId}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, modelId: e.target.value }))
                  }
                >
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="space-y-2">
              <label
                htmlFor="ai-key"
                className="text-text-2 text-sm font-medium"
              >
                API key
              </label>
              <div className="relative">
                <Input
                  id="ai-key"
                  type={showKey ? 'text' : 'password'}
                  placeholder="sk-…"
                  value={form.apiKey}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, apiKey: e.target.value }))
                  }
                  autoComplete="off"
                  className="pr-10"
                />
                <button
                  type="button"
                  className="text-text-3 hover:text-text-2 absolute top-1/2 right-2 -translate-y-1/2 rounded p-1"
                  onClick={() => setShowKey((v) => !v)}
                  aria-label={showKey ? 'Hide API key' : 'Show API key'}
                >
                  {showKey ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </button>
              </div>
            </div>

            {error ? (
              <p className="text-destructive text-sm leading-relaxed" role="alert">
                {error}
              </p>
            ) : null}
            {savedOk ? (
              <p className="text-text-2 text-sm">Settings saved.</p>
            ) : null}

            <Button type="submit" disabled={saving} className="w-full sm:w-auto">
              {saving ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
                  Saving…
                </>
              ) : (
                'Save'
              )}
            </Button>
          </form>
        )}

        <div className="border-border space-y-4 rounded-xl border p-4 shadow-sm md:p-5">
          <div>
            <h2 className="text-text-1 text-base font-semibold tracking-tight">
              Workspace memory
            </h2>
            <p className="text-text-3 mt-1 text-sm leading-relaxed">
              Each workspace keeps notes in{' '}
              <code className="text-text-2 text-xs">.braian/MEMORY.md</code>. The
              assistant reads a summary of this file during chat. Optional
              background updates run only after you pause (debounced), not every
              message.
            </p>
          </div>
          <label className="text-text-2 flex cursor-pointer items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="border-border text-accent-600 mt-0.5 size-4 shrink-0 rounded"
              checked={memoryAutoReview}
              onChange={(e) => {
                const v = e.target.checked
                setMemoryAutoReview(v)
                memorySettingsSet({ autoReviewOnIdle: v })
              }}
            />
            <span>
              <span className="text-text-1 font-medium">
                Automatically update memory when I pause chatting
              </span>
              <span className="text-text-3 mt-1 block text-xs leading-relaxed">
                Uses your configured model and API key after a few minutes of idle
                time; at most about once every 20 minutes per workspace. You can
                always edit the file directly or use &quot;Update memory&quot; under
                Workspace settings for that folder.
              </span>
            </span>
          </label>
        </div>
      </div>
    </div>
  )
}
