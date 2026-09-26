import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { StakingUserError } from '@/lib/nesting/errors'
import { getNestingReadConnection } from '@/lib/solana/nesting/client'

export type OwlRewardTransferStatus = 'sending' | 'sent' | 'recorded' | 'failed'

/**
 * Opens a transfer guard row (status=`sending`) before any OWL leaves the treasury.
 * Throws a {@link StakingUserError} when a prior payout for the wallet is still
 * in-flight or was sent on-chain but never recorded (orphaned), so OWL is never
 * silently re-sent.
 */
const STALE_SENDING_MS = 5 * 60 * 1000

type OwlRewardTransferRow = {
  id: string
  wallet_address: string
  tx_signature: string | null
  status: OwlRewardTransferStatus
  created_at: string
}

async function listStaleSendingOwlRewardTransfers(wallet: string): Promise<OwlRewardTransferRow[]> {
  const db = getSupabaseAdmin()
  const cutoff = new Date(Date.now() - STALE_SENDING_MS).toISOString()
  const { data, error } = await db
    .from('staking_owl_reward_transfers')
    .select('id, wallet_address, tx_signature, status, created_at')
    .eq('wallet_address', wallet.trim())
    .eq('status', 'sending')
    .lte('created_at', cutoff)

  if (error) {
    console.warn('[staking-owl-reward-transfers] listStaleSending:', error.message)
    return []
  }
  return (data ?? []) as OwlRewardTransferRow[]
}

/**
 * Reconcile `sending` guard rows older than five minutes so Claim all can resume safely.
 */
export async function reconcileStaleOwlRewardTransferGuardsForWallet(wallet: string): Promise<void> {
  const stale = await listStaleSendingOwlRewardTransfers(wallet)
  if (stale.length === 0) return

  const conn = getNestingReadConnection()
  for (const row of stale) {
    const sig = row.tx_signature?.trim()
    if (!sig) {
      await markOwlRewardTransferFailed(row.id, 'stale_sending_no_signature').catch(() => {})
      continue
    }
    try {
      const statuses = await conn.getSignatureStatuses([sig], { searchTransactionHistory: true })
      const value = statuses.value[0]
      if (value?.err) {
        await markOwlRewardTransferFailed(row.id, 'stale_sending_onchain_failed').catch(() => {})
        continue
      }
      if (
        value?.confirmationStatus === 'confirmed' ||
        value?.confirmationStatus === 'finalized' ||
        value?.confirmationStatus === 'processed'
      ) {
        await markOwlRewardTransferSent(row.id, sig).catch(() => {})
        continue
      }
      await markOwlRewardTransferFailed(row.id, 'stale_sending_signature_not_found').catch(() => {})
    } catch (e) {
      console.warn(
        '[staking-owl-reward-transfers] reconcile stale sending',
        e instanceof Error ? e.message : e
      )
    }
  }
}

export async function beginOwlRewardTransferGuard(params: {
  wallet: string
  positionIds: string[]
  amountUi: number
}): Promise<string> {
  await reconcileStaleOwlRewardTransferGuardsForWallet(params.wallet)

  const db = getSupabaseAdmin()
  const positionIds = [...new Set(params.positionIds.map((id) => id.trim()).filter(Boolean))]
  const { data, error } = await db.rpc('staking_begin_owl_reward_transfer', {
    p_wallet: params.wallet.trim(),
    p_amount: params.amountUi,
    p_position_ids: positionIds,
  })

  if (error) {
    const msg = error.message ?? ''
    if (msg.includes('owl_reward_transfer_unreconciled')) {
      throw new StakingUserError(
        'A previous OWL claim was sent to your wallet on-chain but is still finalizing in our records. Please contact support before claiming again so we do not double-send.',
        409,
        { code: 'owl_reward_transfer_unreconciled' }
      )
    }
    if (msg.includes('owl_reward_transfer_in_flight')) {
      throw new StakingUserError(
        'A claim is already being processed for your wallet. Wait a moment, then refresh before trying again.',
        409,
        { code: 'owl_reward_transfer_in_flight' }
      )
    }
    if (msg.includes('owl_reward_transfer_stale_sending')) {
      throw new StakingUserError(
        'A previous claim is still being finalized. Wait a moment, refresh, and try again — support can reconcile if this persists.',
        409,
        { code: 'owl_reward_transfer_stale_sending' }
      )
    }
    throw new Error(msg || 'Failed to open OWL reward transfer guard')
  }

  const id = typeof data === 'string' ? data : null
  if (!id) {
    throw new Error('OWL reward transfer guard did not return an id')
  }
  return id
}

async function setOwlRewardTransferStatus(
  id: string,
  status: OwlRewardTransferStatus,
  patch: { tx_signature?: string | null; error?: string | null } = {}
): Promise<void> {
  const db = getSupabaseAdmin()
  const { error } = await db
    .from('staking_owl_reward_transfers')
    .update({ status, updated_at: new Date().toISOString(), ...patch })
    .eq('id', id)
  if (error) {
    throw new Error(error.message)
  }
}

/** Signed tx persisted before broadcast — closes double-pay window if the process dies mid-send. */
export function markOwlRewardTransferSignaturePending(id: string, txSignature: string): Promise<void> {
  return setOwlRewardTransferStatus(id, 'sending', { tx_signature: txSignature.trim() })
}

/** OWL confirmed sent on-chain; row stays blocking until the ledger is recorded. */
export function markOwlRewardTransferSent(id: string, txSignature: string): Promise<void> {
  return setOwlRewardTransferStatus(id, 'sent', { tx_signature: txSignature.trim() })
}

/** Ledger recorded — guard released. */
export function markOwlRewardTransferRecorded(id: string): Promise<void> {
  return setOwlRewardTransferStatus(id, 'recorded')
}

/** No OWL left the treasury (or send failed before landing) — safe to retry. */
export function markOwlRewardTransferFailed(id: string, errorText?: string): Promise<void> {
  return setOwlRewardTransferStatus(id, 'failed', { error: errorText ? errorText.slice(0, 500) : null })
}
