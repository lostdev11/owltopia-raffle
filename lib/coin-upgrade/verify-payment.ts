import { PublicKey, type ParsedTransactionWithMeta } from '@solana/web3.js'

import {
  getCoinArtUpgradeFeeLamports,
  getCoinArtUpgradeFeeSol,
  getCoinArtUpgradePlatformFeeUsd,
} from '@/lib/coin-upgrade/config'
import {
  computeCoinArtUpgradeFeeBreakdown,
  type CoinArtUpgradeFeeSplitConfig,
} from '@/lib/coin-upgrade/fee-split'
import {
  coinArtUpgradePlatformFeeVerifyBand,
  coinArtUpgradePlatformFeeVerifyFallbackBand,
  isCoinArtUpgradePlatformFeeEnabled,
  quoteCoinArtUpgradePlatformFeeLamports,
} from '@/lib/coin-upgrade/platform-fee'
import {
  collectParsedTransactionAccountKeys,
  feePayerMatchesBuyer,
} from '@/lib/gen2-presale/verify-payment'
import { fetchConfirmedParsedTransaction } from '@/lib/nesting/verify-staking-platform-fee'
import { getOwlCenterPlatformTreasuryWallet } from '@/lib/owl-center/platform-treasury'
import {
  sumOwlCenterPresaleSplitFromBuyer,
  verifyOwlCenterPresaleSplitPayment,
} from '@/lib/owl-center-presale/verify-payment'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

export type VerifyCoinArtUpgradeFeeResult =
  | { ok: true; lamports: number; units: number }
  | { ok: false; error: string }

function inferUnitsFromTotalLamports(totalLamports: bigint): number | null {
  const unitLamports = BigInt(getCoinArtUpgradeFeeLamports())
  if (unitLamports <= 0n) return null
  if (totalLamports <= 0n || totalLamports % unitLamports !== 0n) return null
  const units = Number(totalLamports / unitLamports)
  return Number.isFinite(units) && units > 0 ? units : null
}

function treasurySolIncrease(parsed: ParsedTransactionWithMeta, treasuryB58: string): bigint | null {
  const meta = parsed.meta
  if (!meta?.preBalances?.length || !meta.postBalances?.length) return null
  const flat = collectParsedTransactionAccountKeys(parsed)
  let treasuryPk: PublicKey
  try {
    treasuryPk = new PublicKey(treasuryB58)
  } catch {
    return null
  }
  const idx = flat.findIndex((k) => k.equals(treasuryPk))
  if (idx < 0) return null
  return BigInt(meta.postBalances[idx] ?? 0) - BigInt(meta.preBalances[idx] ?? 0)
}

function verifySplitAmounts(params: {
  parsed: ParsedTransactionWithMeta
  fromWallet: string
  split: CoinArtUpgradeFeeSplitConfig
  units: number
}): { ok: true } | { ok: false; error: string } {
  const buyerNorm = normalizeSolanaWalletAddress(params.fromWallet)
  const walletANorm = normalizeSolanaWalletAddress(params.split.walletA)
  const walletBNorm = normalizeSolanaWalletAddress(params.split.walletB)
  if (!buyerNorm || !walletANorm || !walletBNorm) {
    return { ok: false, error: 'Upgrade fee recipients are not configured.' }
  }

  const breakdown = computeCoinArtUpgradeFeeBreakdown(params.units, params.split)
  const exactOk = verifyOwlCenterPresaleSplitPayment({
    parsed: params.parsed,
    buyerWallet: params.fromWallet,
    partnerWallet: params.split.walletA,
    platformFeeWallet: params.split.walletB,
    expectPartnerLamports: breakdown.walletALamports,
    expectPlatformFeeLamports: breakdown.walletBLamports,
  })
  if (!exactOk) {
    return {
      ok: false,
      error: `Upgrade fee must be ${getCoinArtUpgradeFeeSol()} SOL per coin, split ${params.split.percentA}/${params.split.percentB} between the two founder wallets.`,
    }
  }

  return { ok: true }
}

async function verifyPlatformFeePortion(params: {
  parsed: ParsedTransactionWithMeta
  units: number
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isCoinArtUpgradePlatformFeeEnabled()) return { ok: true }

  const treasury = getOwlCenterPlatformTreasuryWallet()
  if (!treasury) {
    return { ok: false, error: 'Platform fee treasury is not configured.' }
  }

  const increase = treasurySolIncrease(params.parsed, treasury)
  if (increase == null || increase <= 0n) {
    return { ok: false, error: 'Platform fee was not paid to the Owltopia treasury in this transaction.' }
  }

  const quote = await quoteCoinArtUpgradePlatformFeeLamports()
  const band = quote
    ? coinArtUpgradePlatformFeeVerifyBand(BigInt(quote.lamports), params.units)
    : coinArtUpgradePlatformFeeVerifyFallbackBand(params.units)

  if (increase < band.minLamports || increase > band.maxLamports) {
    const usd = getCoinArtUpgradePlatformFeeUsd()
    return {
      ok: false,
      error: `Platform fee mismatch: expected ~$${usd.toFixed(2)} per coin (in SOL) to the treasury.`,
    }
  }

  return { ok: true }
}

/**
 * Verifies the holder sent `minUnits` × per-coin upgrade fee, split 50/50 (default) across founder
 * wallets, plus the ~$0.50 platform fee (when enabled) to the platform treasury.
 */
export async function verifyCoinArtUpgradeFeeTransaction(params: {
  signature: string
  fromWallet: string
  split: CoinArtUpgradeFeeSplitConfig
  minUnits: number
}): Promise<VerifyCoinArtUpgradeFeeResult> {
  const unitLamports = getCoinArtUpgradeFeeLamports()
  if (unitLamports <= 0) {
    return { ok: false, error: 'Coin art upgrade fee is not configured.' }
  }
  if (params.minUnits <= 0) {
    return { ok: false, error: 'Invalid upgrade fee unit count.' }
  }

  const parsed = await fetchConfirmedParsedTransaction(params.signature.trim())
  if (!parsed?.meta || parsed.meta.err) {
    return {
      ok: false,
      error: 'Upgrade fee transaction not found or failed on-chain. Wait a moment and try again.',
    }
  }

  const fromPk = new PublicKey(params.fromWallet.trim())
  if (!feePayerMatchesBuyer(parsed, fromPk)) {
    return { ok: false, error: 'Upgrade fee transaction was not signed by your connected wallet.' }
  }

  const buyerNorm = normalizeSolanaWalletAddress(params.fromWallet)
  const walletANorm = normalizeSolanaWalletAddress(params.split.walletA)
  const walletBNorm = normalizeSolanaWalletAddress(params.split.walletB)
  if (!buyerNorm || !walletANorm || !walletBNorm) {
    return { ok: false, error: 'Upgrade fee recipients are not configured.' }
  }

  const got = sumOwlCenterPresaleSplitFromBuyer(parsed, buyerNorm, walletANorm, walletBNorm)
  if (got.total <= 0n) {
    return { ok: false, error: 'Upgrade fee recipients were not credited in this transaction.' }
  }

  const units = inferUnitsFromTotalLamports(got.total)
  if (units == null) {
    return {
      ok: false,
      error: `Upgrade fee amount must be a whole multiple of ${getCoinArtUpgradeFeeSol()} SOL per coin.`,
    }
  }
  if (units < params.minUnits) {
    const needSol = (params.minUnits * unitLamports) / 1e9
    return {
      ok: false,
      error: `Upgrade fee too low: need at least ${needSol} SOL for ${params.minUnits} coin(s) at ${getCoinArtUpgradeFeeSol()} SOL each.`,
    }
  }

  const splitOk = verifySplitAmounts({
    parsed,
    fromWallet: params.fromWallet,
    split: params.split,
    units,
  })
  if (!splitOk.ok) return splitOk

  const platformOk = await verifyPlatformFeePortion({ parsed, units })
  if (!platformOk.ok) return platformOk

  return { ok: true, lamports: Number(got.total), units }
}
