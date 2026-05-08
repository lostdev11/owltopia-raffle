'use client'

import { useCallback, useEffect, useState } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Loader2, LogIn, ThumbsDown, ThumbsUp } from 'lucide-react'
import { useSiwsSignIn } from '@/hooks/use-siws-sign-in'
import type { RaffleSentimentChoice, RaffleSentimentTotals } from '@/lib/db/raffle-sentiment'

const HEADER = 'X-Connected-Wallet'

type RaffleSentimentBarProps = {
  raffleId: string
  sessionWallet: string | null
  initialTotals: RaffleSentimentTotals
  initialMine: RaffleSentimentChoice | null
}

export function RaffleSentimentBar({
  raffleId,
  sessionWallet,
  initialTotals,
  initialMine,
}: RaffleSentimentBarProps) {
  const router = useRouter()
  const { publicKey, connected, signMessage } = useWallet()
  const wallet = publicKey?.toBase58() ?? ''

  const [totals, setTotals] = useState(initialTotals)
  const [mine, setMine] = useState<RaffleSentimentChoice | null>(initialMine)
  const [submitting, setSubmitting] = useState<RaffleSentimentChoice | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { signIn: handleSignIn, signingIn, error: signInError } = useSiwsSignIn()

  useEffect(() => {
    setTotals(initialTotals)
  }, [initialTotals])

  useEffect(() => {
    setMine(initialMine)
  }, [initialMine])

  const sessionMatches = Boolean(sessionWallet && wallet && sessionWallet === wallet)

  const submit = useCallback(
    async (sentiment: RaffleSentimentChoice) => {
      setError(null)
      setSubmitting(sentiment)
      try {
        const res = await fetch(`/api/raffles/${encodeURIComponent(raffleId)}/sentiment`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            [HEADER]: wallet,
          },
          body: JSON.stringify({ sentiment }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          const msg =
            typeof (data as { error?: string }).error === 'string'
              ? (data as { error: string }).error
              : 'Could not save'
          setError(msg)
          return
        }
        const nextTotals = (data as { totals?: RaffleSentimentTotals }).totals
        if (nextTotals && typeof nextTotals.up === 'number' && typeof nextTotals.down === 'number') {
          setTotals(nextTotals)
        }
        setMine(sentiment)
        router.refresh()
      } catch {
        setError('Network error')
      } finally {
        setSubmitting(null)
      }
    },
    [raffleId, wallet, router]
  )

  return (
    <div
      className="border-b border-border/60 bg-muted/5 px-3 py-2 sm:px-4 flex flex-wrap items-center justify-end gap-2"
      role="group"
      aria-label="Raffle reactions"
    >
      {error ? (
        <span className="sr-only" role="alert">
          {error}
        </span>
      ) : null}
      {signInError ? (
        <span className="sr-only" role="alert">
          {signInError}
        </span>
      ) : null}

      {!connected || !wallet ? (
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-[44px] touch-manipulation gap-1.5 px-3 tabular-nums pointer-events-none opacity-50"
            style={{ touchAction: 'manipulation' }}
            disabled
            aria-label={`Thumbs up, ${totals.up}`}
            title="Connect wallet"
          >
            <ThumbsUp className="h-4 w-4 shrink-0" aria-hidden />
            {totals.up}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-[44px] touch-manipulation gap-1.5 px-3 tabular-nums pointer-events-none opacity-50"
            style={{ touchAction: 'manipulation' }}
            disabled
            aria-label={`Thumbs down, ${totals.down}`}
            title="Connect wallet"
          >
            <ThumbsDown className="h-4 w-4 shrink-0" aria-hidden />
            {totals.down}
          </Button>
        </>
      ) : !sessionMatches ? (
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-[44px] min-w-[44px] touch-manipulation px-3"
            style={{ touchAction: 'manipulation' }}
            disabled={signingIn || !signMessage}
            aria-label="Sign in with wallet"
            title={signInError ?? 'Sign in with wallet'}
            onClick={() => void handleSignIn()}
          >
            {signingIn ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <LogIn className="h-4 w-4" aria-hidden />}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-[44px] touch-manipulation gap-1.5 px-3 tabular-nums pointer-events-none opacity-50"
            style={{ touchAction: 'manipulation' }}
            disabled
            aria-label={`Thumbs up, ${totals.up}`}
          >
            <ThumbsUp className="h-4 w-4 shrink-0" aria-hidden />
            {totals.up}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-[44px] touch-manipulation gap-1.5 px-3 tabular-nums pointer-events-none opacity-50"
            style={{ touchAction: 'manipulation' }}
            disabled
            aria-label={`Thumbs down, ${totals.down}`}
          >
            <ThumbsDown className="h-4 w-4 shrink-0" aria-hidden />
            {totals.down}
          </Button>
        </>
      ) : (
        <>
          <Button
            type="button"
            variant={mine === 'up' ? 'default' : 'outline'}
            size="sm"
            className="min-h-[44px] touch-manipulation gap-1.5 px-3 tabular-nums"
            style={{ touchAction: 'manipulation' }}
            disabled={submitting !== null}
            aria-pressed={mine === 'up'}
            aria-label={`Thumbs up, ${totals.up}`}
            onClick={() => void submit('up')}
          >
            {submitting === 'up' ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
            ) : (
              <ThumbsUp className="h-4 w-4 shrink-0" aria-hidden />
            )}
            {totals.up}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={`min-h-[44px] touch-manipulation gap-1.5 px-3 tabular-nums ${
              mine === 'down'
                ? 'border-rose-500/70 bg-rose-500/15 text-rose-900 dark:text-rose-100'
                : ''
            }`}
            style={{ touchAction: 'manipulation' }}
            disabled={submitting !== null}
            aria-pressed={mine === 'down'}
            aria-label={`Thumbs down, ${totals.down}`}
            onClick={() => void submit('down')}
          >
            {submitting === 'down' ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
            ) : (
              <ThumbsDown className="h-4 w-4 shrink-0" aria-hidden />
            )}
            {totals.down}
          </Button>
        </>
      )}
    </div>
  )
}
