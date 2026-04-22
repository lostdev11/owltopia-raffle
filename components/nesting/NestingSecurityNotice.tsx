'use client'

import { ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { NESTING_SECURITY_BULLETS } from '@/lib/nesting/security-notice-content'

type Props = {
  acknowledged: boolean
  onAcknowledgedChange: (next: boolean) => void
  className?: string
}

export function NestingSecurityNotice({ acknowledged, onAcknowledgedChange, className }: Props) {
  return (
    <section
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
            Security checks (review before staking)
          </h2>
          <ul className="text-xs text-muted-foreground space-y-1.5 list-disc pl-4 leading-relaxed">
            {NESTING_SECURITY_BULLETS.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        </div>
      </div>
      <label
        htmlFor="nesting-security-ack"
        className="flex items-start gap-3 pt-2 border-t border-border/60 cursor-pointer touch-manipulation py-2 min-h-[44px] sm:min-h-0 rounded-md -mx-1 px-1 hover:bg-muted/40"
      >
        <input
          id="nesting-security-ack"
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => onAcknowledgedChange(e.target.checked)}
          className="mt-1 h-4 w-4 shrink-0 rounded border-input accent-muted-foreground"
        />
        <span className="text-xs text-muted-foreground leading-snug font-normal">
          I have read the safeguards above. I understand mock staking updates database records only until on-chain pools are
          enabled.
        </span>
      </label>
      <p className="text-[11px] text-muted-foreground/90">
        Preference is saved in session storage for this browsing session only.
      </p>
    </section>
  )
}
