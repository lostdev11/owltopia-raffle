'use client'

import { ShieldAlert } from 'lucide-react'

import {
  GEN2_MINT_WALLET_NOTICE_BULLETS,
  GEN2_MINT_WALLET_NOTICE_HEADLINE,
  GEN2_MINT_WALLET_NOTICE_SUMMARY,
  GEN2_MINT_WALLET_NOTICE_TIPS,
} from '@/lib/owl-center/gen2-mint-wallet-notice'

/** Mobile-first explainer — frozen CM mints trigger false positives in Jupiter and similar scanners. */
export function Gen2MintWalletNotice({ className }: { className?: string }) {
  return (
    <details
      className={`group border border-amber-500/25 bg-amber-950/20 ${className ?? ''}`}
    >
      <summary className="flex min-h-[44px] cursor-pointer touch-manipulation list-none items-center gap-2 px-3 py-2 text-sm text-amber-100/95 [&::-webkit-details-marker]:hidden">
        <ShieldAlert className="h-4 w-4 shrink-0 text-amber-400" aria-hidden />
        <span className="font-medium">{GEN2_MINT_WALLET_NOTICE_HEADLINE}</span>
        <span className="ml-auto font-mono text-[10px] uppercase tracking-widest text-amber-400/80 group-open:hidden">
          Tap
        </span>
      </summary>
      <div className="space-y-3 border-t border-amber-500/20 px-3 pb-3 pt-2 text-xs leading-relaxed text-amber-100/85">
        <p>{GEN2_MINT_WALLET_NOTICE_SUMMARY}</p>
        <ul className="list-disc space-y-1.5 pl-4">
          {GEN2_MINT_WALLET_NOTICE_BULLETS.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <ul className="list-disc space-y-1.5 pl-4 text-amber-100/70">
          {GEN2_MINT_WALLET_NOTICE_TIPS.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
    </details>
  )
}
