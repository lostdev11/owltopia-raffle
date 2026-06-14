import { LAMPORTS_PER_SOL } from '@solana/web3.js'

import { getOptionalLamportsQuoteForUsdc } from '@/lib/gen2-presale/pricing'
import { getOwlCenterPlatformTreasuryWallet } from '@/lib/owl-center/platform-treasury'

/** USD notional for the Owltopia platform fee per NFT mint (collected as SOL on-chain). */
export function owlCenterPlatformMintFeeUsd(): number {
  const raw = process.env.OWL_CENTER_PLATFORM_MINT_FEE_USDC?.trim()
  if (!raw) return 1
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : 1
}

/** @deprecated Use {@link owlCenterPlatformMintFeeUsd} — env name kept for compatibility. */
export function owlCenterPlatformMintFeeUsdc(): number {
  return owlCenterPlatformMintFeeUsd()
}

/** Extra SOL reserved for Candy Machine NFT account rent + network fees (beyond platform fee). */
export const OWL_CENTER_MINT_SOL_RENT_RESERVE_LAMPORTS = 20_000_000n

export function isOwlCenterPlatformMintFeeEnabled(): boolean {
  return owlCenterPlatformMintFeeUsd() > 0
}

/** Server confirm-mint — only enforce on-chain fee when treasury is configured. */
export function shouldRequireOwlCenterPlatformMintFeeServer(): boolean {
  return isOwlCenterPlatformMintFeeEnabled() && !!getOwlCenterPlatformTreasuryWallet()
}

/** Live SOL lamports for the platform fee (~$1 notional via Jupiter SOL/USD). */
export async function owlCenterPlatformMintFeeLamports(): Promise<{
  lamports: bigint
  solUsdPrice: number
} | null> {
  const usd = owlCenterPlatformMintFeeUsd()
  if (usd <= 0) return { lamports: 0n, solUsdPrice: 0 }
  const quote = await getOptionalLamportsQuoteForUsdc(usd)
  if (!quote) return null
  return { lamports: quote.unitLamports, solUsdPrice: quote.solUsdPrice }
}

export function formatOwlCenterPlatformMintFeeLabel(): string {
  const fee = owlCenterPlatformMintFeeUsd()
  if (fee <= 0) return 'No platform mint fee'
  return `~$${fee.toFixed(fee % 1 === 0 ? 0 : 2)} platform fee (paid in SOL)`
}

export function formatOwlCenterPlatformMintFeeSolLabel(lamports: bigint | null | undefined): string {
  if (lamports == null || lamports <= 0n) return formatOwlCenterPlatformMintFeeLabel()
  const sol = Number(lamports) / LAMPORTS_PER_SOL
  const usd = owlCenterPlatformMintFeeUsd()
  const solStr = sol >= 0.01 ? sol.toFixed(3) : sol.toFixed(4)
  return `~${solStr} SOL platform fee (~$${usd.toFixed(usd % 1 === 0 ? 0 : 2)})`
}

export function formatCreatorMintPriceLabel(price: number, currency: 'SOL' | 'USDC'): string {
  if (!Number.isFinite(price) || price <= 0) return 'Free'
  return `${price} ${currency}`
}

export function formatTotalMintCostHint(creatorPrice: number, currency: 'SOL' | 'USDC'): string {
  const platformFee = owlCenterPlatformMintFeeUsd()
  const creator = formatCreatorMintPriceLabel(creatorPrice, currency)
  if (platformFee <= 0) return creator
  if (creatorPrice <= 0) return `Free mint + ${formatOwlCenterPlatformMintFeeLabel()}`
  return `${creator} + ${formatOwlCenterPlatformMintFeeLabel()}`
}
