'use client'

import { NestingStakedAssetThumb } from '@/components/nesting/NestingStakedAssetThumb'
import { buildNestCostEstimate, formatSolAmount } from '@/lib/nesting/staking-platform-fee'
import { cn } from '@/lib/utils'

export type NestWalletPreviewAsset = {
  mint: string
  name?: string | null
  image?: string | null
}

/** Phantom-style preview of the nest lock approval sheet (Approve rows + SOL change). */
export function NestCostSummary({
  assets,
  walletApprovals,
  platformFeeActive,
  assetSingular,
  assetPlural,
  remainingAfterBatch = 0,
  className,
}: {
  assets: NestWalletPreviewAsset[]
  walletApprovals: number
  platformFeeActive: boolean
  assetSingular: string
  assetPlural: string
  /** Nestable items left over once this batch confirms — shown so totals aren't mistaken for the whole flock. */
  remainingAfterBatch?: number
  className?: string
}) {
  const nestCount = assets.length
  const estimate = buildNestCostEstimate({ nestCount, walletApprovals, platformFeeActive })
  if (!estimate) return null

  const solDebit =
    estimate.platformFeeSol > 0 ? `-${formatSolAmount(estimate.platformFeeSol).replace(' SOL', '')} SOL` : null

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border border-white/[0.08] bg-[#0d1110] text-xs text-muted-foreground',
        className
      )}
    >
      <div className="flex items-start justify-between gap-2 border-b border-white/[0.06] px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">Confirm transaction</p>
          <p className="text-[11px] text-muted-foreground">owltopia.xyz · preview of your wallet sheet</p>
        </div>
        <span className="shrink-0 tabular-nums font-semibold text-theme-prime">{estimate.totalLabel}</span>
      </div>

      <p className="px-3 pt-2 text-[11px] leading-snug text-muted-foreground/90">
        Balance changes are estimated. Each row is a nest freeze on that owl — they stay in your wallet.
        Jupiter may flag this as &ldquo;malicious&rdquo; / &ldquo;permission to spend&rdquo;; Phantom may say &ldquo;Approve to
        transfer.&rdquo; Both labels are the wallet&apos;s — not a send or drain.
      </p>

      <ul className="mt-2 max-h-[min(40vh,16rem)] space-y-0.5 overflow-y-auto overscroll-contain px-1.5 pb-1">
        {assets.map((asset) => {
          const label = (asset.name?.trim() || assetSingular).slice(0, 64)
          return (
            <li
              key={asset.mint}
              className="flex min-h-[44px] touch-manipulation items-center gap-2.5 rounded-lg px-2 py-1.5"
            >
              <NestingStakedAssetThumb
                mint={asset.mint}
                hintImageUrl={asset.image ?? null}
                hintName={asset.name ?? null}
                name={asset.name ?? null}
                size="sm"
                className="!h-9 !w-9 !min-h-9 !min-w-9 shrink-0 rounded-full"
              />
              <span className="min-w-0 flex-1 truncate text-[13px] text-foreground/95">
                Freeze for nest <span className="font-medium">{label}</span>
              </span>
            </li>
          )
        })}
        {solDebit ? (
          <li className="flex min-h-[44px] items-center gap-2.5 rounded-lg px-2 py-1.5">
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#9945FF]/15 text-[11px] font-bold text-[#c4a8ff]"
              aria-hidden
            >
              ◎
            </span>
            <span className="min-w-0 flex-1 text-[13px] text-foreground/95">Solana</span>
            <span className="shrink-0 tabular-nums font-medium text-red-400">{solDebit}</span>
          </li>
        ) : null}
      </ul>

      <dl className="space-y-1 border-t border-white/[0.06] px-3 py-2.5">
        <div className="flex items-baseline justify-between gap-3">
          <dt>Network</dt>
          <dd className="text-foreground/90">Solana</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt>Network fee</dt>
          <dd className="tabular-nums text-foreground/90">{estimate.networkFeeLabel}</dd>
        </div>
        {estimate.feePerNestSol > 0 ? (
          <div className="flex items-baseline justify-between gap-3">
            <dt>
              Nest fee · {nestCount} × {estimate.perNestLabel}
            </dt>
            <dd className="tabular-nums text-foreground/90">{estimate.platformFeeLabel}</dd>
          </div>
        ) : null}
      </dl>

      <p className="border-t border-white/[0.06] px-3 py-2.5 leading-relaxed">
        Your {assetPlural} stay in your wallet — nesting only locks them.
        {remainingAfterBatch > 0
          ? ` This batch covers ${nestCount} of ${nestCount + remainingAfterBatch}; nest the other ${remainingAfterBatch} in the next confirm.`
          : ''}
      </p>
    </div>
  )
}
