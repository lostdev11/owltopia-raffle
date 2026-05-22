'use client'

import { CheckCircle2, Loader2, PenLine, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  NESTING_SECURITY_ACK_STATEMENT,
  NESTING_SECURITY_BULLETS,
} from '@/lib/nesting/security-notice-content'

type Props = {
  acknowledged: boolean
  onSignAcknowledgment: () => void | Promise<void>
  signing?: boolean
  signError?: string | null
  walletConnected?: boolean
  className?: string
  id?: string
}

export function NestingSecurityNotice({
  acknowledged,
  onSignAcknowledgment,
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
        'rounded-xl border border-border/80 bg-muted/30 px-4 py-4 sm:px-5 space-y-3',
        className
      )}
      aria-labelledby="nesting-security-heading"
    >
      <div className="flex gap-3">
        <ShieldCheck className="h-5 w-5 shrink-0 text-muted-foreground mt-0.5" aria-hidden />
        <div className="space-y-2 min-w-0">
          <h2 id="nesting-security-heading" className="text-sm font-semibold text-foreground">
            Peek at safeguards before you nest
          </h2>
          <ul className="text-xs text-muted-foreground space-y-1.5 list-disc pl-4 leading-relaxed">
            {NESTING_SECURITY_BULLETS.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        </div>
      </div>
      <div className="pt-2 border-t border-border/60 space-y-3">
        <p className="text-xs text-muted-foreground leading-snug">{NESTING_SECURITY_ACK_STATEMENT}</p>
        {acknowledged ? (
          <div className="flex items-start gap-2 text-xs text-emerald-400/95 min-h-[44px] sm:min-h-0">
            <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
            <p>
              <span className="font-medium text-foreground">Safeguards acknowledged</span> — your wallet signed this for
              this browsing session.
            </p>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-[44px] touch-manipulation w-full sm:w-auto"
            onClick={() => void onSignAcknowledgment()}
            disabled={signing || !walletConnected}
          >
            {signing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <PenLine className="mr-2 h-4 w-4" aria-hidden />
            )}
            Sign safeguards with wallet
          </Button>
        )}
        {!walletConnected && !acknowledged ? (
          <p className="text-xs text-amber-200/95">Connect your wallet in the header to sign.</p>
        ) : null}
        {signError ? <p className="text-xs text-red-400">{signError}</p> : null}
      </div>
      <p className="text-[11px] text-muted-foreground/90">
        Required before you open a new nest (not for claiming OWL you already earned). We remember this for this browsing
        session only, tied to the wallet that signed.
      </p>
    </section>
  )
}
