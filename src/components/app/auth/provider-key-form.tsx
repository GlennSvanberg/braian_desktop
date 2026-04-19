import { useState, type FormEvent } from 'react'
import { useAction, useMutation, useQuery } from 'convex/react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

import { api } from '../../../../convex/_generated/api'

type ProviderId = 'openai' | 'anthropic' | 'gemini'

const PROVIDERS: Array<{
  id: ProviderId
  label: string
  hint: string
  placeholder: string
}> = [
  {
    id: 'openai',
    label: 'OpenAI',
    hint: 'For GPT-4o / GPT-5 etc. Get a key at platform.openai.com → API keys.',
    placeholder: 'sk-...',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    hint: 'For Claude. Get a key at console.anthropic.com → Settings → API keys.',
    placeholder: 'sk-ant-...',
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    hint: 'Get a key at ai.google.dev → API key.',
    placeholder: 'AIza...',
  },
]

type StatusRow = {
  provider: ProviderId
  lastFour: string
  updatedAtMs: number
}

/**
 * Lets the signed-in user enter / update / clear their per-provider API key.
 *
 * Why this lives separate from `SignInCard`:
 *   The card is generic (always shown), but the keys form requires Convex
 *   queries that only run when authenticated. Mounting it conditionally
 *   from the signed-in panel keeps the unauthenticated branch lightweight.
 *
 * The raw key is never read back from the server; we only display the last
 * 4 characters as a confirmation hint after save.
 */
export function ProviderKeyForm() {
  const statuses = useQuery(api.userApiKeys.myApiKeyStatuses, {})
  const setApiKey = useAction(api.userApiKeys.setApiKey)
  const clearApiKey = useMutation(api.userApiKeys.clearApiKey)
  const statusByProvider = new Map<ProviderId, StatusRow>(
    (statuses ?? []).map((s) => [s.provider as ProviderId, s as StatusRow]),
  )
  return (
    <div className="border-border bg-background/40 flex flex-col gap-4 rounded-lg border p-3">
      <div>
        <h3 className="text-text-2 text-xs font-semibold tracking-wide uppercase">
          Provider API keys
        </h3>
        <p className="text-text-3 mt-1 text-xs leading-relaxed">
          Required to chat from the web. Keys are stored encrypted on your
          Convex deployment and proxied to the provider — they never leave
          your account.
        </p>
      </div>
      {PROVIDERS.map((p) => (
        <ProviderKeyRow
          key={p.id}
          provider={p}
          status={statusByProvider.get(p.id) ?? null}
          onSave={async (key) => {
            await setApiKey({ provider: p.id, apiKey: key })
          }}
          onClear={async () => {
            await clearApiKey({ provider: p.id })
          }}
        />
      ))}
    </div>
  )
}

function ProviderKeyRow({
  provider,
  status,
  onSave,
  onClear,
}: {
  provider: (typeof PROVIDERS)[number]
  status: StatusRow | null
  onSave: (key: string) => Promise<void>
  onClear: () => Promise<void>
}) {
  const [editing, setEditing] = useState(status === null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [value, setValue] = useState('')

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    if (!value.trim()) {
      setError('Enter a key first.')
      return
    }
    setPending(true)
    try {
      await onSave(value.trim())
      setValue('')
      setEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save key')
    } finally {
      setPending(false)
    }
  }

  async function onClickClear() {
    setPending(true)
    setError(null)
    try {
      await onClear()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear key')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-col">
          <span className="text-text-1 text-sm font-medium">
            {provider.label}
          </span>
          <span className="text-text-3 text-xs leading-snug">
            {provider.hint}
          </span>
        </div>
        {status && !editing ? (
          <div className="flex items-center gap-2">
            <span className="text-text-3 font-mono text-xs">
              ····{status.lastFour}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setEditing(true)
                setValue('')
                setError(null)
              }}
              disabled={pending}
            >
              Replace
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => void onClickClear()}
              disabled={pending}
            >
              Remove
            </Button>
          </div>
        ) : null}
      </div>
      {editing ? (
        <form
          onSubmit={onSubmit}
          className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-start"
        >
          <Input
            type="password"
            autoComplete="off"
            placeholder={provider.placeholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={pending}
            className="flex-1"
          />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? 'Saving…' : status ? 'Update' : 'Save'}
            </Button>
            {status ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEditing(false)
                  setError(null)
                  setValue('')
                }}
                disabled={pending}
              >
                Cancel
              </Button>
            ) : null}
          </div>
        </form>
      ) : null}
      {error ? (
        <p className="text-destructive text-xs leading-snug">{error}</p>
      ) : null}
    </div>
  )
}
