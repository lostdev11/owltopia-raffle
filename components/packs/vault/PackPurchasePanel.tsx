'use client'

import type { ReactNode } from 'react'
import { ChevronLeft, ChevronRight, ShieldCheck } from 'lucide-react'
import type { VaultPack } from '@/lib/packs/vault-wheel'

type Props = {
  pack: VaultPack
  price: number
  idTick: number
  locked: boolean
  cta: ReactNode
  phaseCaption: string | null
  error: string | null
  loadError: string | null
  pauseMessage: string | null
  onPrev: () => void
  onNext: () => void
}

export function PackPurchasePanel({
  pack,
  price,
  idTick,
  locked,
  cta,
  phaseCaption,
  error,
  loadError,
  pauseMessage,
  onPrev,
  onNext,
}: Props) {
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

      <p className="mt-3 text-center font-display text-2xl tracking-wide text-white">
        {price} SOL
      </p>

      <div className="mt-3">{cta}</div>

      {phaseCaption ? (
        <p className="mt-2 text-center text-sm text-[#00FF9C]/90">{phaseCaption}</p>
      ) : null}
      {pauseMessage ? (
        <p className="mt-2 text-center text-sm text-amber-200/90">{pauseMessage}</p>
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
