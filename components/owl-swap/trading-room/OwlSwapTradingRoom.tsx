'use client'

import dynamic from 'next/dynamic'
import { useEffect, useMemo, useState } from 'react'
import { ArrowLeftRight } from 'lucide-react'
import { OwlSwapChamberOverlay } from '@/components/owl-swap/trading-room/OwlSwapChamberOverlay'
import { OwlSwapTradeReviewBar } from '@/components/owl-swap/trading-room/OwlSwapTradeReviewBar'
import { OwlSwapFeeBreakdown } from '@/components/owl-swap/trading-room/OwlSwapFeeBreakdown'
import { OwlSwapNftInspectDialog } from '@/components/owl-swap/trading-room/OwlSwapNftInspectDialog'
import { OwlSwapTxStatusBanner } from '@/components/owl-swap/trading-room/OwlSwapTxStatusBanner'
import type {
  OwlSwapTxUiState,
  TradingRoomAsset,
} from '@/lib/owl-swap/trading-room-ui-state'
import { formatTradeSummaryLine } from '@/lib/owl-swap/trading-room-ui-state'
import { cn } from '@/lib/utils'

const OwlSwapTradingRoomCanvas = dynamic(
  () =>
    import('@/components/owl-swap/trading-room/OwlSwapTradingRoomCanvas').then(
      (m) => m.OwlSwapTradingRoomCanvas
    ),
  { ssr: false }
)

export type OwlSwapTradingRoomProps = {
  mode: 'create' | 'accept'
  offerAssets: TradingRoomAsset[]
  receiveAssets: TradingRoomAsset[]
  offerSolLamports?: number
  receiveSolLamports?: number
  txState: OwlSwapTxUiState
  errorDetail?: string | null
  feeSolLabel: string | null
  feeAvailable: boolean
  discountPercent?: number
  roleName?: string | null
  ctaLabel: string
  ctaDisabled: boolean
  busy?: boolean
  onPrimary: () => void
  onChangeOffer?: () => void
  offerEmptyCopy?: string
  receiveEmptyCopy?: string
  helperText?: string
  className?: string
}

export function OwlSwapTradingRoom({
  mode,
  offerAssets,
  receiveAssets,
  offerSolLamports = 0,
  receiveSolLamports = 0,
  txState,
  errorDetail,
  feeSolLabel,
  feeAvailable,
  discountPercent = 0,
  roleName = null,
  ctaLabel,
  ctaDisabled,
  busy = false,
  onPrimary,
  onChangeOffer,
  offerEmptyCopy = 'Add NFTs to offer',
  receiveEmptyCopy = 'Awaiting counterparty',
  helperText,
  className,
}: OwlSwapTradingRoomProps) {
  const [feesOpen, setFeesOpen] = useState(false)
  const [inspectSide, setInspectSide] = useState<'offer' | 'receive' | null>(null)
  const [reducedMotion, setReducedMotion] = useState(false)
  const [preferCanvas, setPreferCanvas] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => setReducedMotion(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 900px)')
    const apply = () => setPreferCanvas(mq.matches && !reducedMotion)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [reducedMotion])

  const summaryLine = useMemo(
    () =>
      formatTradeSummaryLine({
        offerCount: offerAssets.length,
        receiveCount: receiveAssets.length,
        offerSolLamports,
        receiveSolLamports,
      }),
    [offerAssets.length, receiveAssets.length, offerSolLamports, receiveSolLamports]
  )

  const inspectAssets = inspectSide === 'receive' ? receiveAssets : offerAssets

  return (
    <div className={cn('relative space-y-4', className)}>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-theme-prime">
            The Trading Room
          </p>
          <h2 className="font-display text-3xl tracking-wide text-white sm:text-4xl">OwlSwap</h2>
          <p className="text-sm text-zinc-400">
            {mode === 'create'
              ? 'A new home for your next owl.'
              : 'Review the maker’s side, then lock in yours.'}
          </p>
        </div>
        <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">Where luck meets logic</p>
      </header>

      <OwlSwapTxStatusBanner state={txState} errorDetail={errorDetail} />

      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-[radial-gradient(ellipse_at_50%_0%,rgba(0,255,136,0.08),transparent_55%),linear-gradient(180deg,#0a0a0a_0%,#050505_100%)]">
        {preferCanvas ? (
          <OwlSwapTradingRoomCanvas
            reducedMotion={reducedMotion}
            className="pointer-events-none absolute inset-0 opacity-70"
          />
        ) : null}

        <div className="relative z-10 grid gap-4 p-3 sm:gap-6 sm:p-5 lg:grid-cols-[1fr_auto_1fr] lg:items-center">
          <OwlSwapChamberOverlay
            side="offer"
            label="You offer"
            assets={offerAssets}
            solLamports={offerSolLamports}
            emptyCopy={offerEmptyCopy}
            primaryActionLabel={onChangeOffer ? 'Change NFT' : undefined}
            onPrimaryAction={onChangeOffer}
            onInspect={offerAssets.length > 0 ? () => setInspectSide('offer') : undefined}
          />

          <div className="flex flex-col items-center justify-center gap-2 py-2 lg:px-2">
            <div className="flex h-14 w-14 items-center justify-center rounded-full border border-theme-prime/50 bg-theme-prime/10 shadow-[0_0_24px_rgba(0,255,136,0.35)]">
              <ArrowLeftRight className="h-6 w-6 text-theme-prime" aria-hidden />
            </div>
            <p className="max-w-[9rem] text-center text-[10px] uppercase tracking-[0.14em] text-zinc-500">
              Good owls better people
            </p>
          </div>

          <OwlSwapChamberOverlay
            side="receive"
            label="You receive"
            assets={receiveAssets}
            solLamports={receiveSolLamports}
            emptyCopy={receiveEmptyCopy}
            onInspect={receiveAssets.length > 0 ? () => setInspectSide('receive') : undefined}
          />
        </div>

        <div className="relative z-10 border-t border-white/10 p-3 sm:p-4">
          <OwlSwapTradeReviewBar
            summaryLine={summaryLine}
            feeLabel={feeSolLabel}
            feeAvailable={feeAvailable}
            ctaLabel={ctaLabel}
            ctaDisabled={ctaDisabled}
            busy={busy}
            onViewFees={() => setFeesOpen(true)}
            onPrimary={onPrimary}
            helperText={helperText}
          />
        </div>
      </div>

      <OwlSwapFeeBreakdown
        open={feesOpen}
        onOpenChange={setFeesOpen}
        feeSolLabel={feeSolLabel}
        feeAvailable={feeAvailable}
        discountPercent={discountPercent}
        roleName={roleName}
      />

      <OwlSwapNftInspectDialog
        open={inspectSide != null}
        onOpenChange={(open) => {
          if (!open) setInspectSide(null)
        }}
        assets={inspectAssets}
        accent={inspectSide === 'receive' ? 'receive' : 'offer'}
      />
    </div>
  )
}
