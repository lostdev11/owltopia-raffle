import { getSupabaseAdmin } from '@/lib/supabase-admin'

export type StakingPlatformFeePaymentRow = {
  tx_signature: string
  wallet_address: string
  action: 'stake' | 'unstake' | 'claim' | 'rev_share_claim'
  units: number
  lamports: number
  position_ids: string[]
  created_at: string
}

export async function getStakingPlatformFeePaymentBySignature(
  txSignature: string
): Promise<StakingPlatformFeePaymentRow | null> {
  const sig = txSignature.trim()
  if (!sig) return null
  const { data, error } = await getSupabaseAdmin()
    .from('staking_platform_fee_payments')
    .select('*')
    .eq('tx_signature', sig)
    .maybeSingle()
  if (error) {
    console.error('[staking-platform-fee-payments] getBySignature:', error.message)
    return null
  }
  if (!data) return null
  return {
    tx_signature: String(data.tx_signature),
    wallet_address: String(data.wallet_address),
    action: data.action as StakingPlatformFeePaymentRow['action'],
    units: Number(data.units),
    lamports: Number(data.lamports),
    position_ids: Array.isArray(data.position_ids) ? data.position_ids.map(String) : [],
    created_at: String(data.created_at),
  }
}

/** True when this nest id is already linked to a recorded platform fee for the action. */
export async function stakingPositionHasPlatformFeeLinked(
  positionId: string,
  action: StakingPlatformFeePaymentRow['action']
): Promise<boolean> {
  const id = positionId.trim()
  if (!id) return false
  const { data, error } = await getSupabaseAdmin()
    .from('staking_platform_fee_payments')
    .select('tx_signature')
    .eq('action', action)
    .contains('position_ids', [id])
    .limit(1)
    .maybeSingle()
  if (error) {
    console.error('[staking-platform-fee-payments] hasPositionLinked:', error.message)
    return false
  }
  return Boolean(data?.tx_signature)
}

export async function insertStakingPlatformFeePayment(row: {
  tx_signature: string
  wallet_address: string
  action: 'stake' | 'unstake' | 'claim' | 'rev_share_claim'
  units: number
  lamports: number
  position_ids: string[]
}): Promise<void> {
  const { error } = await getSupabaseAdmin().from('staking_platform_fee_payments').insert({
    tx_signature: row.tx_signature.trim(),
    wallet_address: row.wallet_address.trim(),
    action: row.action,
    units: row.units,
    lamports: row.lamports,
    position_ids: row.position_ids,
  })
  if (error) {
    throw new Error(error.message)
  }
}

export async function appendStakingPlatformFeePositionIds(
  txSignature: string,
  positionIds: string[]
): Promise<void> {
  const existing = await getStakingPlatformFeePaymentBySignature(txSignature)
  if (!existing) {
    throw new Error('Platform fee payment not found.')
  }
  const merged = [...new Set([...existing.position_ids, ...positionIds.map((id) => id.trim())])]
  const { error } = await getSupabaseAdmin()
    .from('staking_platform_fee_payments')
    .update({ position_ids: merged })
    .eq('tx_signature', txSignature.trim())
  if (error) {
    throw new Error(error.message)
  }
}

/**
 * Recent claim-fee payments for a wallet that still have unused nest capacity
 * (paid more units than nests already linked). Used to recover after OWL payout failure.
 */
export async function listClaimPlatformFeesWithSpareCapacity(params: {
  wallet: string
  minSpareUnits: number
  newerThanIso: string
  limit?: number
}): Promise<StakingPlatformFeePaymentRow[]> {
  const wallet = params.wallet.trim()
  const minSpare = Math.max(1, Math.floor(params.minSpareUnits))
  const limit = Math.min(20, Math.max(1, params.limit ?? 10))
  if (!wallet) return []

  const { data, error } = await getSupabaseAdmin()
    .from('staking_platform_fee_payments')
    .select('*')
    .eq('wallet_address', wallet)
    .eq('action', 'claim')
    .gte('created_at', params.newerThanIso)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('[staking-platform-fee-payments] listSpareCapacity:', error.message)
    return []
  }

  const rows: StakingPlatformFeePaymentRow[] = []
  for (const dataRow of data ?? []) {
    const positionIds = Array.isArray(dataRow.position_ids)
      ? dataRow.position_ids.map(String)
      : []
    const units = Number(dataRow.units)
    if (!Number.isFinite(units) || units - positionIds.length < minSpare) continue
    rows.push({
      tx_signature: String(dataRow.tx_signature),
      wallet_address: String(dataRow.wallet_address),
      action: dataRow.action as StakingPlatformFeePaymentRow['action'],
      units,
      lamports: Number(dataRow.lamports),
      position_ids: positionIds,
      created_at: String(dataRow.created_at),
    })
  }
  return rows
}
