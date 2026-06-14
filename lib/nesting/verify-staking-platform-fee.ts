import type { ParsedTransactionWithMeta } from '@solana/web3.js'
import { Connection, PublicKey } from '@solana/web3.js'

import { collectParsedTransactionAccountKeys } from '@/lib/gen2-presale/verify-payment'
import { getStakingPlatformFeeLamports } from '@/lib/nesting/staking-platform-fee'
import { getSolanaConnection } from '@/lib/solana/connection'

export type VerifyStakingPlatformFeeResult =
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

export async function fetchConfirmedParsedTransaction(
  signature: string,
  connection?: Connection
): Promise<ParsedTransactionWithMeta | null> {
  const conn = connection ?? getSolanaConnection()
  const sig = signature.trim()
  if (!sig) return null

  let tx = await conn.getParsedTransaction(sig, {
    commitment: 'confirmed',
    maxSupportedTransactionVersion: 0,
  })
  if (!tx) {
    await new Promise((r) => setTimeout(r, 600))
    tx = await conn.getParsedTransaction(sig, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    })
  }
  return tx ?? null
}

/**
 * Verifies treasury received at least one platform-fee unit from the expected wallet.
 * Returns how many whole fee units were paid (lamports / unit size).
 */
export async function verifyStakingPlatformFeeTransaction(params: {
  signature: string
  fromWallet: string
  treasuryWallet: string
  minUnits?: number
  parsed?: ParsedTransactionWithMeta | null
}): Promise<VerifyStakingPlatformFeeResult> {
  const unitLamports = getStakingPlatformFeeLamports()
  if (unitLamports <= 0) {
    return { ok: false, error: 'Platform fee is not configured.' }
  }

  const minUnits = params.minUnits ?? 1
  if (minUnits <= 0) {
    return { ok: false, error: 'Invalid fee unit count.' }
  }

  const parsed =
    params.parsed ?? (await fetchConfirmedParsedTransaction(params.signature.trim()))

  if (!parsed?.meta || parsed.meta.err) {
    return {
      ok: false,
      error: 'Fee transaction not found or failed on-chain. Wait a moment and try again.',
    }
  }

  const message = parsed.transaction.message
  const accountKeys =
    'staticAccountKeys' in message
      ? (message as { staticAccountKeys: PublicKey[] }).staticAccountKeys
      : (message as { accountKeys: PublicKey[] }).accountKeys

  const fromPk = new PublicKey(params.fromWallet.trim())
  const feePayerKey = accountKeys?.[0]
  if (!feePayerKey) {
    return { ok: false, error: 'Invalid fee transaction: no fee payer.' }
  }
  const feePayerMatches =
    typeof feePayerKey === 'string'
      ? feePayerKey === params.fromWallet.trim()
      : (feePayerKey as PublicKey).equals(fromPk)
  if (!feePayerMatches) {
    return { ok: false, error: 'Fee transaction was not signed by your connected wallet.' }
  }

  const increase = treasurySolIncrease(parsed, params.treasuryWallet.trim())
  if (increase == null || increase <= 0n) {
    return { ok: false, error: 'Platform treasury was not credited in this transaction.' }
  }

  const unit = BigInt(unitLamports)
  const units = Number(increase / unit)
  if (units < minUnits) {
    const needSol = (minUnits * unitLamports) / 1e9
    return {
      ok: false,
      error: `Platform fee too low: need at least ${needSol} SOL for ${minUnits} nest(s).`,
    }
  }

  const remainder = increase % unit
  const tolerance = BigInt(Math.max(10_000, Math.floor(unitLamports * 0.02)))
  if (remainder > tolerance) {
    return {
      ok: false,
      error: 'Platform fee amount must be a whole multiple of the per-nest fee.',
    }
  }

  return { ok: true, lamports: Number(increase), units }
}
