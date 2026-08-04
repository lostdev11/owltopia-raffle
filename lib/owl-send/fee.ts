import { LAMPORTS_PER_SOL } from '@solana/web3.js'
import { getPlatformFeeTreasuryWalletAddressClient } from '@/lib/solana/platform-fee-treasury-wallet'
import { OWL_SEND_DEFAULT_FEE_SOL } from '@/lib/owl-send/constants'
import {
  applyOwlSendFeeDiscountLamports,
  clampOwlSendDiscountBps,
} from '@/lib/owl-send/holder-discount'

function readFeeSolFromEnv(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

/** Per-transfer Owl fee in SOL (default 0.001) before holder discount. */
export function getOwlSendFeeSol(): number {
  const raw =
    typeof process !== 'undefined'
      ? process.env.OWL_SEND_FEE_SOL?.trim() ||
        process.env.NEXT_PUBLIC_OWL_SEND_FEE_SOL?.trim()
      : undefined
  return readFeeSolFromEnv(raw, OWL_SEND_DEFAULT_FEE_SOL)
}

/** Base per-line fee in lamports (no discount). */
export function getOwlSendFeeLamports(): number {
  const sol = getOwlSendFeeSol()
  if (sol <= 0) return 0
  return Math.round(sol * LAMPORTS_PER_SOL)
}

/**
 * Owl platform fee for `count` transfer lines.
 * Optional `discountBps` applies the Owltopia holder discount (floor per line).
 */
export function getOwlSendFeeLamportsForCount(count: number, discountBps = 0): number {
  return applyOwlSendFeeDiscountLamports(getOwlSendFeeLamports(), count, discountBps)
}

/** Per-line fee in SOL after discount (display). */
export function getOwlSendFeeSolForDiscount(discountBps = 0): number {
  const base = getOwlSendFeeLamports()
  if (base <= 0) return 0
  const discounted = applyOwlSendFeeDiscountLamports(base, 1, clampOwlSendDiscountBps(discountBps))
  return discounted / LAMPORTS_PER_SOL
}

export function isOwlSendFeeEnabledClient(): boolean {
  const lamports = getOwlSendFeeLamports()
  return lamports > 0 && !!getPlatformFeeTreasuryWalletAddressClient()
}

export function formatOwlSendFeeSol(sol: number): string {
  if (sol <= 0) return '0 SOL'
  if (sol < 0.0001) return `${sol.toFixed(6)} SOL`
  if (sol >= 0.01) return `${sol.toFixed(3)} SOL`
  return `${sol.toFixed(4)} SOL`
}
