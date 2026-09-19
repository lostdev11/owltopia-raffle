'use client'

import type { ReactNode } from 'react'
import { ChevronLeft, ChevronRight, ShieldCheck } from 'lucide-react'
import { CurrencyIcon } from '@/components/CurrencyIcon'
import { PACK_DEFAULT_OWL_SOL_PRICE, resolveOwlSolPrice } from '@/lib/packs/config'
import type { VaultPack } from '@/lib/packs/vault-wheel'
import { cn } from '@/lib/utils'

type Props = {
  pack: VaultPack
  price: number
  /** SOL per 1 OWL — used to show the upcoming $OWL pack price. */
  owlSolPrice?: number | null
  idTick: number
  locked: boolean
  cta: ReactNode
  phaseCaption: string | null
  error: string | null
  loadError: string | null
  pauseMessage: string | null
  /** Soft warning when connected wallet SOL cannot cover pack + fee. */
  fundHint: string | null
  onPrev: () => void
  onNext: () => void
}

function formatOwlPackPrice(priceSol: number, owlSolPrice: number | null | undefined): string {
  const rate = resolveOwlSolPrice(owlSolPrice ?? PACK_DEFAULT_OWL_SOL_PRICE)
  if (!(rate > 0) || !(priceSol > 0)) return '—'
  const owl = priceSol / rate
  if (owl >= 100) return owl.toFixed(0)
  if (owl >= 10) return owl.toFixed(owl % 1 === 0 ? 0 : 1)
  return owl.toFixed(owl % 1 === 0 ? 0 : 2).replace(/\.?0+$/, '')
}

export function PackPurchasePanel({
  pack,
  price,
  owlSolPrice = null,
  idTick,
  locked,
  cta,
  phaseCaption,
  error,
  loadError,
  pauseMessage,
  fundHint,
  onPrev,
  onNext,
}: Props) {
  const priceOwlLabel = formatOwlPackPrice(price, owlSolPrice)

  return (
    <div className="relative z-10 mx-auto mt-3 w-full max-w-sm px-1 sm:mt-4">
      <div className="flex items-center justify-center gap-3 sm:gap-4">
        <button
          type="button"
          aria-label="Previous pack"
          disabled={locked}
          onClick={onPrev}
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-[#00FF9C]/30 bg-black/40 text-[#00FF9C] touch-manipulation disabled:opacity-40"
          style={{ touchAction: 'manipulation' }}
        >
          <ChevronLeft className="h-6 w-6" aria-hidden />
        </button>
        <p
          key={idTick}
          className="min-w-0 text-center font-display text-lg tracking-[0.18em] text-white animate-vault-id-tick motion-reduce:animate-none sm:text-xl"
        >
          PACK #{pack.idLabel}
          <span className="mt-0.5 block text-[10px] font-sans font-semibold uppercase tracking-[0.28em] text-[#00FF9C]/85">
            Selected
          </span>
        </p>
        <button
          type="button"
          aria-label="Next pack"
          disabled={locked}
          onClick={onNext}
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-[#00FF9C]/30 bg-black/40 text-[#00FF9C] touch-manipulation disabled:opacity-40"
          style={{ touchAction: 'manipulation' }}
        >
          <ChevronRight className="h-6 w-6" aria-hidden />
        </button>
      </div>

      <div
        className="mt-3 grid grid-cols-2 gap-2"
        role="group"
        aria-label="Pack payment currency"
      >
        <div
          className={cn(
            'flex min-h-[52px] flex-col items-center justify-center gap-0.5 rounded-xl border px-2 py-2',
            'border-[#00FF9C]/55 bg-[#00FF9C]/12 text-white'
          )}
          aria-current="true"
        >
          <span className="inline-flex items-center gap-1.5 text-sm font-bold uppercase tracking-[0.12em]">
            <CurrencyIcon currency="SOL" size={16} />
            SOL
          </span>
          <span className="font-display text-lg tracking-wide">{price} SOL</span>
        </div>
        <button
          type="button"
          disabled
          aria-disabled="true"
          title="$OWL checkout coming soon"
          className={cn(
            'relative flex min-h-[52px] flex-col items-center justify-center gap-0.5 rounded-xl border px-2 py-2',
            'cursor-not-allowed border-white/10 bg-white/[0.03] text-white/35 touch-manipulation',
            'opacity-55 grayscale'
          )}
          style={{ touchAction: 'manipulation' }}
        >
          <span className="absolute right-1.5 top-1 rounded bg-white/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-white/50">
            Soon
          </span>
          <span className="inline-flex items-center gap-1.5 text-sm font-bold uppercase tracking-[0.12em]">
            <CurrencyIcon currency="OWL" size={16} className="opacity-60" />
            $OWL
          </span>
          <span className="font-display text-lg tracking-wide">{priceOwlLabel} $OWL</span>
        </button>
      </div>

      <div className="mt-3">{cta}</div>

      {phaseCaption ? (
        <p className="mt-2 text-center text-sm text-[#00FF9C]/90">{phaseCaption}</p>
      ) : null}
      {pauseMessage ? (
        <p className="mt-2 text-center text-sm text-amber-200/90">{pauseMessage}</p>
      ) : null}
      {fundHint && !error ? (
        <p className="mt-2 text-center text-sm text-amber-200/90">{fundHint}</p>
      ) : null}
      {error ? <p className="mt-2 text-center text-sm text-red-300">{error}</p> : null}
      {loadError ? <p className="mt-2 text-center text-sm text-red-300">{loadError}</p> : null}

      <p className="mt-2 inline-flex w-full items-center justify-center gap-1.5 text-[11px] uppercase tracking-[0.18em] text-white/40">
        <ShieldCheck className="h-3.5 w-3.5 text-[#00FF9C]/70" aria-hidden />
        Secure checkout with Solana
      </p>
      <p className="mt-2 text-center text-[11px] uppercase tracking-[0.18em] text-white/40">
        Selecting a pack does not reserve it
      </p>
    </div>
  )
}
