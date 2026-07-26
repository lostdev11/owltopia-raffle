'use client'

import { CheckCircle2, Loader2, PenLine, ShieldCheck, Usb } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  NESTING_SECURITY_ACK_STATEMENT,
  NESTING_SECURITY_BULLETS,
} from '@/lib/nesting/security-notice-content'

type Props = {
  acknowledged: boolean
  onSignAcknowledgment: () => void | Promise<void>
  /** Ledger / hardware path: sign a memo transaction (not broadcast). */
  onSignWithLedger?: () => void | Promise<void>
  canSignWithLedger?: boolean
  signing?: boolean
  signError?: string | null
  walletConnected?: boolean
  className?: string
  id?: string
}

export function NestingSecurityNotice({
  acknowledged,
  onSignAcknowledgment,
  onSignWithLedger,
  canSignWithLedger = false,
  signing = false,
  signError = null,
  walletConnected = true,
  className,
  id,
}: Props) {
  return (
    <section
      id={id}
      className={cn(
        'rounded-xl px-4 py-4 sm:px-5 space-y-3 scroll-mt-24',
        acknowledged
          ? 'border border-border/80 bg-muted/30'
          : 'border border-theme-prime/35 bg-theme-prime/[0.07]',
        className
      )}
      aria-labelledby="nesting-security-heading"
    >
      <div className="flex gap-3">
        <ShieldCheck
          className={cn(
            'h-5 w-5 shrink-0 mt-0.5',
            acknowledged ? 'text-emerald-400/95' : 'text-theme-prime'
          )}
          aria-hidden
        />
        <div className="space-y-2 min-w-0">
          {!acknowledged ? (
            <p className="text-[11px] font-semibold uppercase tracking-wide text-theme-prime/90">
              Quick step before you nest
            </p>
          ) : null}
          <h2
            id="nesting-security-heading"
            className={cn(
              'text-sm font-semibold',
              acknowledged ? 'text-foreground' : 'text-foreground'
            )}
          >
            {acknowledged ? 'Nesting notes signed for this session' : 'Sign nesting notes to continue'}
          </h2>
          {!acknowledged ? (
            <p className="text-xs text-muted-foreground leading-relaxed">
              One short wallet signature unlocks nesting, claiming, and leaving a nest. Takes a few seconds —
              do this first so Confirm nest works.
            </p>
          ) : null}
          <ul
            className={cn(
              'text-xs space-y-1.5 list-disc pl-4 leading-relaxed',
              'text-muted-foreground'
            )}
          >
            {NESTING_SECURITY_BULLETS.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        </div>
      </div>
      <div
        className={cn(
          'pt-2 border-t space-y-3',
          acknowledged ? 'border-border/60' : 'border-theme-prime/25'
        )}
      >
        <p className="text-xs leading-snug text-muted-foreground">{NESTING_SECURITY_ACK_STATEMENT}</p>
        {acknowledged ? (
          <div className="flex items-start gap-2 text-xs text-emerald-400/95 min-h-[44px] sm:min-h-0">
            <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
            <p>
              <span className="font-medium text-foreground">You&apos;re cleared to nest</span> — your wallet signed this
              for this browsing session.
            </p>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row gap-2">
            <Button
              type="button"
              variant="default"
              size="sm"
              className="min-h-[48px] touch-manipulation w-full sm:w-auto font-semibold"
              onClick={() => void onSignAcknowledgment()}
              disabled={signing || !walletConnected}
            >
              {signing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <PenLine className="mr-2 h-4 w-4" aria-hidden />
              )}
              Sign nesting notes
            </Button>
            {canSignWithLedger && onSignWithLedger ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-[48px] touch-manipulation w-full sm:w-auto"
                onClick={() => void onSignWithLedger()}
                disabled={signing || !walletConnected}
              >
                {signing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Usb className="mr-2 h-4 w-4" aria-hidden />
                )}
                Sign with Ledger
              </Button>
            ) : null}
          </div>
        )}
        {!acknowledged && canSignWithLedger ? (
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Using Ledger? Phantom Sign Message often fails with error Code 1. Use{' '}
            <span className="font-medium text-foreground">Sign with Ledger</span> — approve the memo on the device
            (not broadcast, no Owltopia fee). Unlock Ledger, open Solana app, close Ledger Live, prefer USB.
          </p>
        ) : null}
        {!walletConnected && !acknowledged ? (
          <p className="text-xs text-muted-foreground">Connect your wallet in the header to sign.</p>
        ) : null}
        {signError ? <p className="text-xs text-red-400 whitespace-pre-wrap">{signError}</p> : null}
      </div>
      <p className="text-[11px] text-muted-foreground/90">
        Required once per browsing session (not for claiming OWL you already earned). Tied to the wallet that signed.
      </p>
    </section>
  )
}
