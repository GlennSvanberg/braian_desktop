import { useState, type FormEvent } from 'react'
import { useAuthActions } from '@convex-dev/auth/react'
import { useConvexAuth, useQuery } from 'convex/react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { isCloudConfigured } from '@/lib/cloud/convex-client'
import { cn } from '@/lib/utils'

import { api } from '../../../../convex/_generated/api'

import { ProviderKeyForm } from './provider-key-form'

type Flow = 'signIn' | 'signUp'

/**
 * Email + password sign-in/up card for Convex Auth.
 *
 * Uses the simple `Password` provider configured in `convex/auth.ts`.
 * Magic link / OAuth are intentionally excluded in V1 to keep the env-var
 * footprint at exactly one (`VITE_CONVEX_URL`).
 *
 * Renders a friendly placeholder when cloud sync isn't configured (no
 * `VITE_CONVEX_URL`) so the settings page is always shippable.
 */
export function SignInCard({ className }: { className?: string }) {
  if (!isCloudConfigured()) {
    return (
      <div
        className={cn(
          'border-border bg-card/50 rounded-xl border p-4 md:p-5',
          className,
        )}
      >
        <h2 className="text-text-2 mb-2 text-xs font-semibold tracking-wide uppercase">
          Cloud sync
        </h2>
        <p className="text-text-3 text-sm leading-relaxed">
          Cloud sync is not configured for this build. Set
          {' '}<code className="text-text-2">VITE_CONVEX_URL</code> in
          {' '}<code className="text-text-2">.env.local</code> and restart the
          app to enable continuing conversations across devices.
        </p>
      </div>
    )
  }
  return <SignInCardInner className={className} />
}

function SignInCardInner({ className }: { className?: string }) {
  const { isAuthenticated, isLoading } = useConvexAuth()
  if (isLoading) {
    return <CloudCardShell className={className}>Connecting...</CloudCardShell>
  }
  if (isAuthenticated) {
    return <SignedInPanel className={className} />
  }
  return <SignedOutPanel className={className} />
}

function CloudCardShell({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'border-border bg-card/50 rounded-xl border p-4 md:p-5',
        className,
      )}
    >
      <h2 className="text-text-2 mb-2 text-xs font-semibold tracking-wide uppercase">
        Cloud sync
      </h2>
      <div className="text-text-2 text-sm leading-relaxed">{children}</div>
    </div>
  )
}

function SignedInPanel({ className }: { className?: string }) {
  const { signOut } = useAuthActions()
  const me = useQuery(api.conversations.listMine, {})
  const count = Array.isArray(me) ? me.length : null
  return (
    <CloudCardShell className={className}>
      <div className="flex flex-col gap-2">
        <p>
          Cloud sync is on. New chats and edits sync to your account so you
          can continue them on another device.
        </p>
        {count != null ? (
          <p className="text-text-3 text-xs">
            {count === 0
              ? 'No cloud chats yet - start a chat to sync it.'
              : `${count} chat${count === 1 ? '' : 's'} synced.`}
          </p>
        ) : null}
        <ProviderKeyForm />
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void signOut()
            }}
          >
            Sign out
          </Button>
        </div>
      </div>
    </CloudCardShell>
  )
}

function SignedOutPanel({ className }: { className?: string }) {
  const { signIn } = useAuthActions()
  const [flow, setFlow] = useState<Flow>('signIn')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setPending(true)
    try {
      const formData = new FormData(e.currentTarget)
      formData.set('flow', flow)
      await signIn('password', formData)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sign-in failed'
      setError(msg)
    } finally {
      setPending(false)
    }
  }

  return (
    <CloudCardShell className={className}>
      <p className="text-text-3 mb-3 text-sm">
        Sign in to continue conversations across your phone, laptop, and any
        web browser. Your local desktop chats keep working without an account.
      </p>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="cloud-email"
            className="text-text-2 text-xs font-medium"
          >
            Email
          </label>
          <Input
            id="cloud-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            disabled={pending}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="cloud-password"
            className="text-text-2 text-xs font-medium"
          >
            Password
          </label>
          <Input
            id="cloud-password"
            name="password"
            type="password"
            autoComplete={flow === 'signIn' ? 'current-password' : 'new-password'}
            minLength={8}
            required
            disabled={pending}
          />
        </div>
        {error ? (
          <p className="text-destructive text-xs leading-relaxed">{error}</p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="sm" disabled={pending}>
            {pending
              ? flow === 'signIn'
                ? 'Signing in...'
                : 'Creating account...'
              : flow === 'signIn'
                ? 'Sign in'
                : 'Create account'}
          </Button>
          <button
            type="button"
            className="text-text-3 hover:text-text-2 text-xs underline-offset-2 hover:underline"
            onClick={() => {
              setFlow(flow === 'signIn' ? 'signUp' : 'signIn')
              setError(null)
            }}
            disabled={pending}
          >
            {flow === 'signIn'
              ? 'Need an account? Sign up'
              : 'Already have an account? Sign in'}
          </button>
        </div>
      </form>
    </CloudCardShell>
  )
}
