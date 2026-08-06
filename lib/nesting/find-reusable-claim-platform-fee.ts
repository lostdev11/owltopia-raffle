import { PublicKey } from '@solana/web3.js'

import {
  getStakingPlatformFeePaymentBySignature,
  listClaimPlatformFeesWithSpareCapacity,
} from '@/lib/db/staking-platform-fee-payments'
import { isStakingPlatformFeeEnabled } from '@/lib/nesting/staking-platform-fee'
import { verifyStakingPlatformFeeTransaction } from '@/lib/nesting/verify-staking-platform-fee'
import { getNestingReadConnection } from '@/lib/solana/nesting/client'
import { getPlatformFeeTreasuryWalletAddress } from '@/lib/solana/platform-fee-treasury-wallet'

/** Bounded recovery scan — same order as candy-machine mint recovery, not a wallet portfolio sweep. */
export const CLAIM_FEE_RECOVERY_MAX_SIGNATURES = 20
export const CLAIM_FEE_RECOVERY_MAX_AGE_MS = 48 * 60 * 60 * 1000

/**
 * Finds a recent claim platform-fee signature the wallet already paid that can cover
 * `minUnits` nests — either spare capacity in DB, or an on-chain fee never linked because
 * the OWL payout failed after the wallet approval.
 */
export async function findReusableClaimPlatformFeeSignature(params: {
  wallet: string
  minUnits: number
  nowMs?: number
}): Promise<string | null> {
  if (!isStakingPlatformFeeEnabled()) return null

  const wallet = params.wallet.trim()
  const minUnits = Math.floor(params.minUnits)
  if (!wallet || !Number.isFinite(minUnits) || minUnits < 1) return null

  const treasury = getPlatformFeeTreasuryWalletAddress()?.trim()
  if (!treasury) return null

  const nowMs = params.nowMs ?? Date.now()
  const newerThanIso = new Date(nowMs - CLAIM_FEE_RECOVERY_MAX_AGE_MS).toISOString()

  const spare = await listClaimPlatformFeesWithSpareCapacity({
    wallet,
    minSpareUnits: minUnits,
    newerThanIso,
  })
  if (spare[0]?.tx_signature) {
    return spare[0].tx_signature.trim()
  }

  let owner: PublicKey
  try {
    owner = new PublicKey(wallet)
  } catch {
    return null
  }

  const conn = getNestingReadConnection()
  let sigInfos: Awaited<ReturnType<typeof conn.getSignaturesForAddress>>
  try {
    sigInfos = await conn.getSignaturesForAddress(owner, {
      limit: CLAIM_FEE_RECOVERY_MAX_SIGNATURES,
    })
  } catch (e) {
    console.warn(
      '[findReusableClaimPlatformFee] getSignaturesForAddress failed',
      e instanceof Error ? e.message : e
    )
    return null
  }

  const cutoffSec = Math.floor((nowMs - CLAIM_FEE_RECOVERY_MAX_AGE_MS) / 1000)

  for (const info of sigInfos) {
    if (info.err) continue
    const blockTime = info.blockTime ?? null
    if (blockTime != null && blockTime < cutoffSec) continue

    const signature = info.signature?.trim()
    if (!signature) continue

    const existing = await getStakingPlatformFeePaymentBySignature(signature)
    if (existing) {
      // Already fully linked, or wrong action — skip. Spare capacity was handled above.
      continue
    }

    const verified = await verifyStakingPlatformFeeTransaction({
      signature,
      fromWallet: wallet,
      treasuryWallet: treasury,
      minUnits,
    })
    if (!verified.ok) continue
    if (verified.units < minUnits) continue

    return signature
  }

  return null
}
