'use client'

import { useCallback, useEffect, useState } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Loader2, ThumbsDown, ThumbsUp } from 'lucide-react'
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
              : 'Could not save your reaction'
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
        setError('Network error. Try again on Wi‑Fi if you are on mobile data.')
      } finally {
        setSubmitting(null)
      }
    },
    [raffleId, wallet, router]
  )

  return (
    <div
      className="border-b border-border/60 bg-muted/5 px-3 py-3 sm:px-4 sm:py-3.5"
      aria-labelledby="raffle-sentiment-heading"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0 space-y-1">
          <p id="raffle-sentiment-heading" className="text-sm font-medium text-foreground">
            How do you like this raffle?
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Quick feedback — one vote per wallet; you can change it anytime.
          </p>
          <p className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
            <span className="inline-flex items-center gap-1">
              <ThumbsUp className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden />
              {totals.up}
            </span>
            <span className="mx-2 text-muted-foreground/50">·</span>
            <span className="inline-flex items-center gap-1">
              <ThumbsDown className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400" aria-hidden />
              {totals.down}
            </span>
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:items-end shrink-0 w-full sm:w-auto">
          {!connected || !wallet ? (
            <p className="text-xs text-muted-foreground sm:text-right">
              Connect your wallet in the header to react.
            </p>
          ) : !sessionWallet || !sessionMatches ? (
            <div className="flex flex-col gap-2 w-full sm:max-w-xs sm:ml-auto">
              <p className="text-xs text-muted-foreground sm:text-right">
                {sessionWallet && sessionWallet !== wallet
                  ? 'Signed-in wallet does not match the connected wallet. Sign in with the wallet you connected.'
                  : 'Sign in once so we can attach your reaction to your wallet (same as the dashboard).'}
              </p>
              {signInError ? <p className="text-xs text-destructive sm:text-right">{signInError}</p> : null}
              <Button
                type="button"
                variant="outline"
                className="min-h-[44px] touch-manipulation w-full sm:w-auto"
                disabled={signingIn || !signMessage}
                onClick={() => void handleSignIn()}
              >
                {signingIn ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden />
                    Signing…
                  </>
                ) : (
                  'Sign in with wallet'
                )}
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2 w-full sm:justify-end">
              {error ? <p className="text-xs text-destructive w-full sm:text-right">{error}</p> : null}
              <Button
                type="button"
                variant={mine === 'up' ? 'default' : 'outline'}
                size="default"
                className="min-h-[44px] min-w-[44px] touch-manipulation flex-1 sm:flex-none gap-2"
                style={{ touchAction: 'manipulation' }}
                disabled={submitting !== null}
                aria-pressed={mine === 'up'}
                onClick={() => void submit('up')}
              >
                {submitting === 'up' ? (
                  <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden />
                ) : (
                  <ThumbsUp className="h-4 w-4 shrink-0" aria-hidden />
                )}
                <span className="sm:inline">Up</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                size="default"
                className={`min-h-[44px] min-w-[44px] touch-manipulation flex-1 sm:flex-none gap-2 ${
                  mine === 'down'
                    ? 'border-rose-500/70 bg-rose-500/15 text-rose-900 dark:text-rose-100'
                    : ''
                }`}
                style={{ touchAction: 'manipulation' }}
                disabled={submitting !== null}
                aria-pressed={mine === 'down'}
                onClick={() => void submit('down')}
              >
                {submitting === 'down' ? (
                  <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden />
                ) : (
                  <ThumbsDown className="h-4 w-4 shrink-0" aria-hidden />
                )}
                <span className="sm:inline">Down</span>
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
