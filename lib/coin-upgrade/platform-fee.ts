import 'server-only'

import { LAMPORTS_PER_SOL } from '@solana/web3.js'

import { getCoinArtUpgradePlatformFeeUsd } from '@/lib/coin-upgrade/config'
import { getOptionalLamportsQuoteForUsdc } from '@/lib/gen2-presale/pricing'
import { getOwlCenterPlatformTreasuryWallet } from '@/lib/owl-center/platform-treasury'

export { formatCoinArtUpgradePlatformFeeLabel } from '@/lib/coin-upgrade/config'

export function isCoinArtUpgradePlatformFeeEnabled(): boolean {
  return getCoinArtUpgradePlatformFeeUsd() > 0 && !!getOwlCenterPlatformTreasuryWallet()
}

/** Live SOL lamports for one coin’s ~$0.50 platform fee. */
export async function quoteCoinArtUpgradePlatformFeeLamports(): Promise<{
  lamports: number
  sol_usd_price: number
  usd: number
  treasury: string
} | null> {
  const usd = getCoinArtUpgradePlatformFeeUsd()
  const treasury = getOwlCenterPlatformTreasuryWallet()
  if (usd <= 0 || !treasury) return null
  const quote = await getOptionalLamportsQuoteForUsdc(usd)
  if (!quote || quote.unitLamports <= 0n) return null
  const lamports = Number(quote.unitLamports)
  if (!Number.isFinite(lamports) || lamports <= 0) return null
  return {
    lamports,
    sol_usd_price: quote.solUsdPrice,
    usd,
    treasury,
  }
}

/** Verification band for oracle drift between wallet build and server confirm. */
export function coinArtUpgradePlatformFeeVerifyBand(unitLamports: bigint, units: number): {
  minLamports: bigint
  maxLamports: bigint
} {
  const qty = BigInt(Math.max(1, Math.floor(units)))
  const expected = unitLamports * qty
  const tolerance = BigInt(Math.max(50_000, Math.floor(Number(unitLamports) * 0.15))) * qty
  const minLamports = expected > tolerance ? expected - tolerance : 0n
  const maxLamports = expected + tolerance
  return { minLamports, maxLamports }
}

/** Wide fallback when Jupiter is down at confirm time (~$0.40–$2.50 at typical SOL/USD). */
export function coinArtUpgradePlatformFeeVerifyFallbackBand(units: number): {
  minLamports: bigint
  maxLamports: bigint
} {
  const usd = getCoinArtUpgradePlatformFeeUsd()
  const qty = Math.max(1, Math.floor(units))
  if (usd <= 0) return { minLamports: 0n, maxLamports: 0n }
  const minLamports = BigInt(Math.max(2_000_000, Math.floor((usd * 0.4 / 250) * LAMPORTS_PER_SOL))) * BigInt(qty)
  const maxLamports = BigInt(Math.ceil((usd * 2.5 / 40) * LAMPORTS_PER_SOL)) * BigInt(qty)
  return { minLamports, maxLamports }
}
