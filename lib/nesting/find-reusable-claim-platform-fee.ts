import { PublicKey } from '@solana/web3.js'

import {
  getStakingPlatformFeePaymentBySignature,
  listClaimPlatformFeesWithSpareCapacity,
  type StakingPlatformFeePaymentRow,
} from '@/lib/db/staking-platform-fee-payments'
import {
  getStakingPlatformFeeLamports,
  getStakingPlatformFeeUnitLamportsForAction,
  isStakingPlatformFeeEnabled,
} from '@/lib/nesting/staking-platform-fee'
import { verifyStakingPlatformFeeTransaction } from '@/lib/nesting/verify-staking-platform-fee'
import { getNestingReadConnection } from '@/lib/solana/nesting/client'
import { getPlatformFeeTreasuryWalletAddress } from '@/lib/solana/platform-fee-treasury-wallet'

/** Page size for `getSignaturesForAddress` while scanning the 48h fee window. */
export const CLAIM_FEE_RECOVERY_PAGE_SIZE = 50
/** Safety cap on pages scanned (wallet poisoning dust can push the fee deep). */
export const CLAIM_FEE_RECOVERY_MAX_PAGES = 40
export const CLAIM_FEE_RECOVERY_MAX_AGE_MS = 48 * 60 * 60 * 1000

/**
 * Finds a recent claim / rev-share platform-fee signature the wallet already paid that can cover
 * `minUnits` nests — either spare capacity in DB, or an on-chain fee never linked because
 * the payout failed after the wallet approval.
 */
export async function findReusableClaimPlatformFeeSignature(params: {
  wallet: string
  minUnits: number
  action?: Extract<StakingPlatformFeePaymentRow['action'], 'claim' | 'rev_share_claim'>
  nowMs?: number
}): Promise<string | null> {
  if (!isStakingPlatformFeeEnabled()) return null

  const wallet = params.wallet.trim()
  const minUnits = Math.floor(params.minUnits)
  const action = params.action ?? 'claim'
  if (!wallet || !Number.isFinite(minUnits) || minUnits < 1) return null

  const treasury = getPlatformFeeTreasuryWalletAddress()?.trim()
  if (!treasury) return null

  const nowMs = params.nowMs ?? Date.now()
  const newerThanIso = new Date(nowMs - CLAIM_FEE_RECOVERY_MAX_AGE_MS).toISOString()
  const unitLamports = getStakingPlatformFeeUnitLamportsForAction(action)
  if (unitLamports <= 0) return null

  const spare = await listClaimPlatformFeesWithSpareCapacity({
    wallet,
    minSpareUnits: minUnits,
    newerThanIso,
    action,
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
  const cutoffSec = Math.floor((nowMs - CLAIM_FEE_RECOVERY_MAX_AGE_MS) / 1000)

  let before: string | undefined
  for (let page = 0; page < CLAIM_FEE_RECOVERY_MAX_PAGES; page++) {
    let sigInfos: Awaited<ReturnType<typeof conn.getSignaturesForAddress>>
    try {
      sigInfos = await conn.getSignaturesForAddress(owner, {
        limit: CLAIM_FEE_RECOVERY_PAGE_SIZE,
        before,
      })
    } catch (e) {
      console.warn(
        '[findReusableClaimPlatformFee] getSignaturesForAddress failed',
        e instanceof Error ? e.message : e
      )
      return null
    }

    if (sigInfos.length === 0) break

    let reachedCutoff = false
    for (const info of sigInfos) {
      if (info.err) continue
      const blockTime = info.blockTime ?? null
      if (blockTime != null && blockTime < cutoffSec) {
        reachedCutoff = true
        continue
      }

      const signature = info.signature?.trim()
      if (!signature) continue

      const existing = await getStakingPlatformFeePaymentBySignature(signature)
      if (existing) {
        continue
      }

      const verified = await verifyStakingPlatformFeeTransaction({
        signature,
        fromWallet: wallet,
        treasuryWallet: treasury,
        minUnits,
        unitLamports,
      })
      if (!verified.ok) continue
      if (verified.units < minUnits) continue

      // Do not treat an OWL-rate fee (0.001/nest) as a rev-share fee (0.0001/nest).
      if (action === 'rev_share_claim') {
        const owlUnit = getStakingPlatformFeeLamports()
        if (owlUnit > unitLamports && verified.lamports % owlUnit === 0) {
          const owlUnits = Math.floor(verified.lamports / owlUnit)
          if (owlUnits >= minUnits) continue
        }
      }

      return signature
    }

    if (reachedCutoff) break
    if (sigInfos.length < CLAIM_FEE_RECOVERY_PAGE_SIZE) break
    before = sigInfos[sigInfos.length - 1]?.signature
    if (!before) break
  }

  return null
}
