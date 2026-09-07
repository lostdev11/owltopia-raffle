'use client'

import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

export type DashboardSiwsSignInGateProps = {
  signingIn: boolean
  signInError: string | null
  canSignMessage: boolean
  canSignTransaction: boolean
  onSignIn: () => void
  onSignInWithLedgerTx: () => void
}

/**
 * My Dashboard SIWS gate — message sign-in with Ledger memo-tx option.
 * Ticket refunds require this session cookie.
 */
export function DashboardSiwsSignInGate({
  signingIn,
  signInError,
  canSignMessage,
  canSignTransaction,
  onSignIn,
  onSignInWithLedgerTx,
}: DashboardSiwsSignInGateProps) {
  return (
    <main className="container mx-auto px-4 py-8 max-w-2xl">
      <h1 className="text-2xl font-bold mb-4">My Dashboard</h1>
      <p className="text-muted-foreground mb-4">
        Sign in with your wallet to see your raffles, entries, and revenue — including ticket refunds when a raffle
        fails the minimum. This is a one-time proof (no Owltopia fee).
      </p>
      {canSignTransaction ? (
        <p className="text-sm text-muted-foreground mb-4 rounded-md border border-border/60 bg-muted/30 px-3 py-2">
          Using Ledger? Phantom/Solflare Sign Message often fails with{' '}
          <span className="font-medium text-foreground">Invalid signature</span>. Tap{' '}
          <span className="font-medium text-foreground">Sign with Ledger transaction</span> — unlock the device, open
          the Solana app, close Ledger Live, prefer USB on desktop, then approve the memo (not broadcast).
        </p>
      ) : null}
      {signInError ? <p className="text-destructive mb-4 whitespace-pre-wrap">{signInError}</p> : null}
      <div className="flex flex-col sm:flex-row gap-2">
        <Button
          onClick={onSignIn}
          disabled={signingIn || (!canSignMessage && !canSignTransaction)}
          className="min-h-[44px] touch-manipulation bg-green-600 hover:bg-green-700 text-white"
        >
          {signingIn ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Waiting for wallet / Ledger…
            </>
          ) : (
            'Sign in with wallet'
          )}
        </Button>
        {canSignTransaction ? (
          <Button
            type="button"
            variant="outline"
            className="min-h-[44px] touch-manipulation"
            disabled={signingIn}
            onClick={onSignInWithLedgerTx}
          >
            Sign with Ledger transaction
          </Button>
        ) : null}
      </div>
      {!canSignMessage && !canSignTransaction ? (
        <p className="text-sm text-muted-foreground mt-2">
          Your connected wallet does not support signing. Try Phantom or Solflare.
        </p>
      ) : null}
    </main>
  )
}
