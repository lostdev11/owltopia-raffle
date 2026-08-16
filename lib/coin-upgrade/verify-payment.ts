import type { ParsedTransactionWithMeta } from '@solana/web3.js'
import { PublicKey } from '@solana/web3.js'

import { collectParsedTransactionAccountKeys, feePayerMatchesBuyer } from '@/lib/gen2-presale/verify-payment'
import { fetchConfirmedParsedTransaction } from '@/lib/nesting/verify-staking-platform-fee'
import { getCoinArtUpgradeFeeLamports, getCoinArtUpgradeFeeSol } from '@/lib/coin-upgrade/config'

export type VerifyCoinArtUpgradeFeeResult =
  | { ok: true; lamports: number; units: number }
  | { ok: false; error: string }

function treasurySolIncrease(parsed: ParsedTransactionWithMeta, treasuryB58: string): bigint | null {
  const meta = parsed.meta
  if (!meta?.preBalances?.length || !meta.postBalances?.length) return null

  let treasuryPk: PublicKey
  try {
    treasuryPk = new PublicKey(treasuryB58)
  } catch {
    return null
  }

  const flat = collectParsedTransactionAccountKeys(parsed)
  const idx = flat.findIndex((k) => k.equals(treasuryPk))
  if (idx < 0) return null
  return BigInt(meta.postBalances[idx] ?? 0) - BigInt(meta.preBalances[idx] ?? 0)
}

/**
 * Verifies the treasury received `minUnits` × per-coin upgrade fee from the holder wallet
 * (staking platform fee verification pattern, 0.1 SOL units instead of 0.001).
 */
export async function verifyCoinArtUpgradeFeeTransaction(params: {
  signature: string
  fromWallet: string
  treasuryWallet: string
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

  const increase = treasurySolIncrease(parsed, params.treasuryWallet.trim())
  if (increase == null || increase <= 0n) {
    return { ok: false, error: 'Platform treasury was not credited in this transaction.' }
  }

  const unit = BigInt(unitLamports)
  const units = Number(increase / unit)
  if (units < params.minUnits) {
    const needSol = (params.minUnits * unitLamports) / 1e9
    return {
      ok: false,
      error: `Upgrade fee too low: need at least ${needSol} SOL for ${params.minUnits} coin(s) at ${getCoinArtUpgradeFeeSol()} SOL each.`,
    }
  }

  const remainder = increase % unit
  const tolerance = BigInt(Math.max(10_000, Math.floor(unitLamports * 0.02)))
  if (remainder > tolerance) {
    return {
      ok: false,
      error: 'Upgrade fee amount must be a whole multiple of the per-coin fee.',
    }
  }

  return { ok: true, lamports: Number(increase), units }
}
