import { PublicKey } from '@solana/web3.js'

import { getCoinArtUpgradeFeeLamports } from '@/lib/coin-upgrade/config'
import { GEN2_MINT_FUND_SPLITS_FALLBACK } from '@/lib/owl-center/gen2-mint-proceeds'

export type CoinArtUpgradeFeeSplitConfig = {
  walletA: string
  walletB: string
  percentA: number
  percentB: number
}

export type CoinArtUpgradeFeeBreakdown = {
  totalLamports: bigint
  walletALamports: bigint
  walletBLamports: bigint
}

function parsePercent(raw: string | undefined, fallback: number): number {
  const t = typeof raw === 'string' ? raw.trim() : ''
  if (!t) return fallback
  const n = Number(t)
  if (!Number.isFinite(n) || n < 0 || n > 100) return fallback
  return Math.round(n)
}

function isValidSolanaAddress(value: string): boolean {
  try {
    // eslint-disable-next-line no-new
    new PublicKey(value)
    return true
  } catch {
    return false
  }
}

function defaultFounderWallets(): { walletA: string; walletB: string } {
  return {
    walletA: GEN2_MINT_FUND_SPLITS_FALLBACK[0]?.address ?? '',
    walletB: GEN2_MINT_FUND_SPLITS_FALLBACK[1]?.address ?? '',
  }
}

/**
 * Coin art upgrade proceeds: 50/50 between the two founder wallets (Gembird split).
 * Defaults match Gen2 `mint_fund_splits` / `FOUNDER_A_WALLET` + `FOUNDER_B_WALLET`.
 */
export function getCoinArtUpgradeFeeSplitConfig(): CoinArtUpgradeFeeSplitConfig | null {
  const defaults = defaultFounderWallets()
  const walletA =
    process.env.COIN_ART_UPGRADE_SPLIT_A_WALLET?.trim() ||
    process.env.FOUNDER_A_WALLET?.trim() ||
    defaults.walletA
  const walletB =
    process.env.COIN_ART_UPGRADE_SPLIT_B_WALLET?.trim() ||
    process.env.FOUNDER_B_WALLET?.trim() ||
    defaults.walletB

  if (!walletA || !walletB) return null
  if (!isValidSolanaAddress(walletA) || !isValidSolanaAddress(walletB)) return null
  if (walletA === walletB) return null

  let percentA = parsePercent(
    process.env.COIN_ART_UPGRADE_SPLIT_A_PERCENT ?? process.env.FOUNDER_A_PERCENT,
    50
  )
  let percentB = parsePercent(
    process.env.COIN_ART_UPGRADE_SPLIT_B_PERCENT ?? process.env.FOUNDER_B_PERCENT,
    50
  )
  if (percentA + percentB !== 100) {
    percentA = 50
    percentB = 50
  }

  return { walletA, walletB, percentA, percentB }
}

/** Per-request fee breakdown; remainder lamports go to wallet B (gen2 presale pattern). */
export function computeCoinArtUpgradeFeeBreakdown(
  units: number,
  split: Pick<CoinArtUpgradeFeeSplitConfig, 'percentA' | 'percentB'>
): CoinArtUpgradeFeeBreakdown {
  if (!Number.isFinite(units) || units <= 0 || !Number.isInteger(units)) {
    throw new Error('units must be a positive integer')
  }

  const unitLamports = BigInt(getCoinArtUpgradeFeeLamports())
  const totalLamports = unitLamports * BigInt(units)
  const walletALamports = (totalLamports * BigInt(split.percentA)) / 100n
  const walletBLamports = totalLamports - walletALamports

  if (walletALamports + walletBLamports !== totalLamports) {
    throw new Error('internal: coin art upgrade lamport split mismatch')
  }

  return { totalLamports, walletALamports, walletBLamports }
}
