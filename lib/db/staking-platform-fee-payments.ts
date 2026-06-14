import { getSupabaseAdmin } from '@/lib/supabase-admin'

export type StakingPlatformFeePaymentRow = {
  tx_signature: string
  wallet_address: string
  action: 'stake' | 'unstake' | 'claim'
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

export async function insertStakingPlatformFeePayment(row: {
  tx_signature: string
  wallet_address: string
  action: 'stake' | 'unstake' | 'claim'
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
