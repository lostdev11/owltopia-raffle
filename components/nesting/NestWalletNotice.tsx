'use client'

import {
  NEST_WALLET_NOTICE_BULLETS,
  NEST_WALLET_NOTICE_HEADLINE,
  NEST_WALLET_NOTICE_SUMMARY,
  nestWalletNoticeDelegateLine,
} from '@/lib/nesting/nest-wallet-notice'

/** Quiet pre-sign note — Phantom-style matter-of-fact, not a security alarm. */
export function NestWalletNotice({
  className,
  delegateAddress,
}: {
  className?: string
  /** Configured nesting freeze authority — shown so users can recognize it in the wallet preview. */
  delegateAddress?: string
}) {
  return (
    <details className={`group ${className ?? ''}`}>
      <summary className="flex min-h-[44px] cursor-pointer touch-manipulation list-none items-center gap-2 px-1 py-1 text-xs text-muted-foreground [&::-webkit-details-marker]:hidden">
        <span>{NEST_WALLET_NOTICE_HEADLINE}</span>
        <span className="ml-auto text-[10px] text-muted-foreground/70 group-open:hidden">Details</span>
      </summary>
      <div className="mt-1 space-y-2 rounded-xl border border-white/[0.05] bg-black/25 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
        <p>{NEST_WALLET_NOTICE_SUMMARY}</p>
        <ul className="space-y-1.5 border-t border-white/[0.04] pt-2">
          {NEST_WALLET_NOTICE_BULLETS.map((line) => (
            <li key={line} className="leading-relaxed">
              {line}
            </li>
          ))}
        </ul>
        {delegateAddress?.trim() ? (
          <p className="break-all border-t border-white/[0.04] pt-2 font-mono text-[11px] text-muted-foreground/80">
            {nestWalletNoticeDelegateLine(delegateAddress.trim())}
          </p>
        ) : null}
      </div>
    </details>
  )
}
