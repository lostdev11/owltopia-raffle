import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { StakingUserError } from '@/lib/nesting/errors'

export type OwlRewardTransferStatus = 'sending' | 'sent' | 'recorded' | 'failed'

/**
 * Opens a transfer guard row (status=`sending`) before any OWL leaves the treasury.
 * Throws a {@link StakingUserError} when a prior payout for the wallet is still
 * in-flight or was sent on-chain but never recorded (orphaned), so OWL is never
 * silently re-sent.
 */
export async function beginOwlRewardTransferGuard(params: {
  wallet: string
  positionIds: string[]
  amountUi: number
}): Promise<string> {
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
