import { LAMPORTS_PER_SOL } from '@solana/web3.js'
import { getPlatformFeeTreasuryWalletAddressClient } from '@/lib/solana/platform-fee-treasury-wallet'
import { OWL_SWAP_DEFAULT_FEE_SOL } from '@/lib/owl-swap/constants'
import {
  applyOwlSendFeeDiscountLamports,
  clampOwlSendDiscountBps,
} from '@/lib/owl-send/holder-discount'

function readFeeSolFromEnv(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

/** Per-swap Owl fee in SOL (default 0.02) before holder discount. */
export function getOwlSwapFeeSol(): number {
  const raw =
    typeof process !== 'undefined'
      ? process.env.OWL_SWAP_FEE_SOL?.trim() ||
        process.env.NEXT_PUBLIC_OWL_SWAP_FEE_SOL?.trim()
      : undefined
  return readFeeSolFromEnv(raw, OWL_SWAP_DEFAULT_FEE_SOL)
}

/** Base fee in lamports for one swap (no discount). */
export function getOwlSwapFeeLamports(): number {
  const sol = getOwlSwapFeeSol()
  if (sol <= 0) return 0
  return Math.round(sol * LAMPORTS_PER_SOL)
}

/**
 * Owl platform fee for `swapCount` completed swaps (usually 1).
 * Optional `discountBps` applies the Owltopia holder discount ladder.
 */
export function getOwlSwapFeeLamportsForCount(swapCount: number, discountBps = 0): number {
  return applyOwlSendFeeDiscountLamports(getOwlSwapFeeLamports(), swapCount, discountBps)
}

/** Per-swap fee in SOL after discount (display). */
export function getOwlSwapFeeSolForDiscount(discountBps = 0): number {
  const base = getOwlSwapFeeLamports()
  if (base <= 0) return 0
  const discounted = applyOwlSendFeeDiscountLamports(
    base,
    1,
    clampOwlSendDiscountBps(discountBps)
  )
  return discounted / LAMPORTS_PER_SOL
}

export function isOwlSwapFeeEnabledClient(): boolean {
  const lamports = getOwlSwapFeeLamports()
  return lamports > 0 && !!getPlatformFeeTreasuryWalletAddressClient()
}

export function formatOwlSwapFeeSol(sol: number): string {
  if (sol <= 0) return '0 SOL'
  if (sol < 0.0001) return `${sol.toFixed(6)} SOL`
  if (sol >= 0.01) return `${sol.toFixed(3)} SOL`
  return `${sol.toFixed(4)} SOL`
}

/** Offer TTL hours from env or default. */
export function getOwlSwapOfferTtlHours(): number {
  const raw =
    typeof process !== 'undefined' ? process.env.OWL_SWAP_OFFER_TTL_HOURS?.trim() : undefined
  if (!raw) return 72
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.min(720, Math.floor(n)) : 72
}
