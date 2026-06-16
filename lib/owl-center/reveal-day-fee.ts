import { LAMPORTS_PER_SOL } from '@solana/web3.js'

import { getOptionalLamportsQuoteForUsdc } from '@/lib/gen2-presale/pricing'
import { getOwlCenterPlatformTreasuryWallet } from '@/lib/owl-center/platform-treasury'

/** USD notional for Owltopia Reveal Day service (collected as SOL on-chain). */
export function owlCenterRevealDayFeeUsd(): number {
  const raw = process.env.OWL_CENTER_REVEAL_DAY_FEE_USDC?.trim()
  if (!raw) return 49
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : 49
}

export function isOwlCenterRevealDayFeeEnabled(): boolean {
  return owlCenterRevealDayFeeUsd() > 0
}

export function shouldRequireOwlCenterRevealDayFeeServer(): boolean {
  return isOwlCenterRevealDayFeeEnabled() && !!getOwlCenterPlatformTreasuryWallet()
}

export async function owlCenterRevealDayFeeLamports(): Promise<{
  lamports: bigint
  solUsdPrice: number
} | null> {
  const usd = owlCenterRevealDayFeeUsd()
  if (usd <= 0) return { lamports: 0n, solUsdPrice: 0 }
  const quote = await getOptionalLamportsQuoteForUsdc(usd)
  if (!quote) return null
  return { lamports: quote.unitLamports, solUsdPrice: quote.solUsdPrice }
}

export function formatOwlCenterRevealDayFeeLabel(): string {
  const fee = owlCenterRevealDayFeeUsd()
  if (fee <= 0) return 'Reveal Day included'
  return `~$${fee.toFixed(fee % 1 === 0 ? 0 : 2)} Reveal Day fee (paid in SOL)`
}

export function formatOwlCenterRevealDayFeeSolLabel(lamports: bigint | null | undefined): string {
  if (lamports == null || lamports <= 0n) return formatOwlCenterRevealDayFeeLabel()
  const sol = Number(lamports) / LAMPORTS_PER_SOL
  const usd = owlCenterRevealDayFeeUsd()
  const solStr = sol >= 0.01 ? sol.toFixed(3) : sol.toFixed(4)
  return `~${solStr} SOL (~$${usd.toFixed(usd % 1 === 0 ? 0 : 2)})`
}

export function owlCenterRevealDayFeeVerifyBand(unitLamports: bigint): {
  minLamports: bigint
  maxLamports: bigint
} {
  const tolerance = BigInt(Math.max(100_000, Math.floor(Number(unitLamports) * 0.15)))
  const minLamports = unitLamports > tolerance ? unitLamports - tolerance : 0n
  const maxLamports = unitLamports + tolerance
  return { minLamports, maxLamports }
}

export function owlCenterRevealDayFeeVerifyFallbackBand(): { minLamports: bigint; maxLamports: bigint } {
  const usd = owlCenterRevealDayFeeUsd()
  if (usd <= 0) return { minLamports: 0n, maxLamports: 0n }
  const minLamports = BigInt(Math.max(5_000_000, Math.floor((usd * 0.4 / 250) * LAMPORTS_PER_SOL)))
  const maxLamports = BigInt(Math.ceil((usd * 2.5 / 40) * LAMPORTS_PER_SOL))
  return { minLamports, maxLamports }
}
