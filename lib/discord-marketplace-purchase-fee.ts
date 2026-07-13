/**
 * Owltopia Discord marketplace purchase fee (~$1 USD, paid in SOL to platform treasury).
 * Applies to SOL / OWL priced listings (on-chain checkout). Points purchases stay points-only.
 */
import { LAMPORTS_PER_SOL } from '@solana/web3.js'
import { getOptionalLamportsQuoteForUsdc } from '@/lib/gen2-presale/pricing'
import { getPlatformFeeTreasuryWalletAddress } from '@/lib/solana/platform-fee-treasury-wallet'

/** USD notional for the marketplace purchase fee (default $1). Env: DISCORD_MARKETPLACE_PURCHASE_FEE_USD */
export function discordMarketplacePurchaseFeeUsd(): number {
  const raw = process.env.DISCORD_MARKETPLACE_PURCHASE_FEE_USD?.trim()
  if (!raw) return 1
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : 1
}

export function isDiscordMarketplacePurchaseFeeEnabled(): boolean {
  return discordMarketplacePurchaseFeeUsd() > 0 && !!getPlatformFeeTreasuryWalletAddress()
}

export async function discordMarketplacePurchaseFeeLamports(): Promise<{
  lamports: bigint
  solUsdPrice: number
  usd: number
} | null> {
  const usd = discordMarketplacePurchaseFeeUsd()
  if (usd <= 0) return { lamports: 0n, solUsdPrice: 0, usd: 0 }
  if (!getPlatformFeeTreasuryWalletAddress()) return null
  const quote = await getOptionalLamportsQuoteForUsdc(usd)
  if (!quote) return null
  return { lamports: quote.unitLamports, solUsdPrice: quote.solUsdPrice, usd }
}

export function formatDiscordMarketplacePurchaseFeeLabel(lamports: bigint | null | undefined): string {
  const usd = discordMarketplacePurchaseFeeUsd()
  if (usd <= 0) return 'No platform fee'
  if (lamports == null || lamports <= 0n) {
    return `~$${usd.toFixed(usd % 1 === 0 ? 0 : 2)} platform fee (paid in SOL)`
  }
  const sol = Number(lamports) / LAMPORTS_PER_SOL
  const solStr = sol >= 0.01 ? sol.toFixed(4) : sol.toFixed(6)
  return `~${solStr} SOL platform fee (~$${usd.toFixed(usd % 1 === 0 ? 0 : 2)})`
}

/** Allowed lamports variance vs frozen quote (±2% or 5k lamports, whichever larger). */
export function platformFeeLamportsWithinTolerance(expected: bigint, observed: bigint): boolean {
  if (expected <= 0n) return observed === 0n
  const pct = expected / 50n // 2%
  const floor = 5_000n
  const tol = pct > floor ? pct : floor
  const lo = expected > tol ? expected - tol : 0n
  const hi = expected + tol
  return observed >= lo && observed <= hi
}
