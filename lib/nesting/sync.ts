/**
 * Transaction-first sync: one `getParsedTransaction` per call — see `rpc-policy.ts`.
 * Full instruction decoding waits for the staking program IDL.
 */

import { getStakingPoolById } from '@/lib/db/staking-pools'
import {
  getStakingPositionForWallet,
  patchStakingPosition,
  type StakingPositionRow,
} from '@/lib/db/staking-positions'
import { StakingUserError } from '@/lib/nesting/errors'
import { fetchParsedTransactionOnce, parsedTransactionInvolvesWallet } from '@/lib/nesting/chain-tx'
import {
  NESTING_SIGNATURE_MAX_LEN,
  NESTING_SIGNATURE_MIN_LEN,
} from '@/lib/nesting/rpc-policy'

export type StakingSyncKind = 'stake' | 'unstake' | 'claim'

function isPlausibleTxSignature(sig: string): boolean {
  const s = sig.trim()
  return s.length >= NESTING_SIGNATURE_MIN_LEN && s.length <= NESTING_SIGNATURE_MAX_LEN
}

function allowsUserTriggerSync(
  position: StakingPositionRow,
  pool: Awaited<ReturnType<typeof getStakingPoolById>>
): boolean {
  if (!pool) return false
  if (position.sync_status === 'pending' || position.sync_status === 'stale') return true
  if (pool.adapter_mode === 'onchain_enabled') return true
  if (pool.is_onchain_enabled === true) return true
  if (pool.requires_onchain_sync === true) return true
  return false
}

/**
 * Verifies a user-submitted transaction id and updates the read model.
 * **One RPC** via `fetchParsedTransactionOnce`.
 */
export async function syncStakingPositionBySignature(params: {
  positionId: string
  wallet: string
  signature: string
  kind: StakingSyncKind
}): Promise<{ position: StakingPositionRow }> {
  if (!isPlausibleTxSignature(params.signature)) {
    throw new StakingUserError('Invalid transaction signature', 400)
  }

  const position = await getStakingPositionForWallet(params.positionId, params.wallet)
  if (!position) {
    throw new StakingUserError('Position not found', 404)
  }

  const pool = await getStakingPoolById(position.pool_id)
  if (!pool) {
    throw new StakingUserError('Pool not found', 400)
  }

  if (!allowsUserTriggerSync(position, pool)) {
    throw new StakingUserError(
      'On-chain sync is not required for this position. Use mock / solana_ready pools for DB-only stakes.',
      400
    )
  }

  const now = new Date().toISOString()
  const tx = await fetchParsedTransactionOnce(params.signature)
  if (!tx) {
    await patchStakingPosition(params.positionId, {
      sync_status: 'failed',
      last_synced_at: now,
      last_transaction_error: 'Transaction not found (cluster or signature)',
    })
    throw new StakingUserError('Transaction not found on cluster', 404)
  }

  if (tx.meta?.err) {
    await patchStakingPosition(params.positionId, {
      sync_status: 'failed',
      last_synced_at: now,
      last_transaction_error: JSON.stringify(tx.meta.err),
    })
    throw new StakingUserError('Transaction failed on-chain', 400, { err: tx.meta.err })
  }

  if (!parsedTransactionInvolvesWallet(tx, params.wallet)) {
    throw new StakingUserError('This transaction does not reference your wallet', 400)
  }

  const sig = params.signature.trim()
  const updates: Partial<{
    stake_signature: string | null
    unstake_signature: string | null
    last_claim_signature: string | null
  }> = {}
  if (params.kind === 'stake') updates.stake_signature = sig
  if (params.kind === 'unstake') updates.unstake_signature = sig
  if (params.kind === 'claim') updates.last_claim_signature = sig

  const updated = await patchStakingPosition(params.positionId, {
    ...updates,
    sync_status: 'confirmed',
    last_synced_at: now,
    last_transaction_error: null,
  })

  return { position: updated }
}

/**
 * Admin / batch: re-verify a row that already stores a signature. **One RPC** per call.
 * Program-specific checks (vault balances, PDAs) belong here later.
 */
export async function verifyStakingPositionFromChainByRow(
  position: StakingPositionRow
): Promise<{ position: StakingPositionRow; ok: true } | { ok: false; error: string }> {
  const sig =
    position.stake_signature?.trim() ||
    position.unstake_signature?.trim() ||
    position.last_claim_signature?.trim() ||
    null

  if (!sig || !isPlausibleTxSignature(sig)) {
    return { ok: false, error: 'No valid signature on this position' }
  }

  const now = new Date().toISOString()
  const tx = await fetchParsedTransactionOnce(sig)
  if (!tx) {
    await patchStakingPosition(position.id, {
      sync_status: 'failed',
      last_synced_at: now,
      last_transaction_error: 'Transaction not found during reconcile',
    })
    return { ok: false, error: 'Transaction not found' }
  }

  if (tx.meta?.err) {
    await patchStakingPosition(position.id, {
      sync_status: 'failed',
      last_synced_at: now,
      last_transaction_error: JSON.stringify(tx.meta.err),
    })
    return { ok: false, error: 'Transaction failed on-chain' }
  }

  if (!parsedTransactionInvolvesWallet(tx, position.wallet_address)) {
    return { ok: false, error: 'Transaction does not reference position wallet' }
  }

  const next = await patchStakingPosition(position.id, {
    sync_status: 'confirmed',
    last_synced_at: now,
    last_transaction_error: null,
  })
  return { position: next, ok: true }
}
