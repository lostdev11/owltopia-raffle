import { getSupabaseAdmin } from '@/lib/supabase-admin'

export type PartnerNestRewardDepositRow = {
  id: string
  pool_id: string
  reward_mint: string
  amount: number
  transaction_signature: string
  depositor_wallet: string
  created_at: string
}

function mapRow(data: Record<string, unknown>): PartnerNestRewardDepositRow {
  return {
    id: String(data.id),
    pool_id: String(data.pool_id),
    reward_mint: String(data.reward_mint),
    amount: Number(data.amount),
    transaction_signature: String(data.transaction_signature),
    depositor_wallet: String(data.depositor_wallet),
    created_at: String(data.created_at ?? new Date().toISOString()),
  }
}

export async function getPartnerNestRewardDepositBySignature(
  signature: string
): Promise<PartnerNestRewardDepositRow | null> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('partner_nest_reward_deposits')
    .select('*')
    .eq('transaction_signature', signature.trim())
    .maybeSingle()
  if (error || !data) return null
  return mapRow(data as Record<string, unknown>)
}

export async function listPartnerNestRewardDepositsForPool(
  poolId: string,
  limit = 25
): Promise<PartnerNestRewardDepositRow[]> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('partner_nest_reward_deposits')
    .select('*')
    .eq('pool_id', poolId)
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 100))
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => mapRow(row as Record<string, unknown>))
}

export async function insertPartnerNestRewardDeposit(input: {
  pool_id: string
  reward_mint: string
  amount: number
  transaction_signature: string
  depositor_wallet: string
}): Promise<{ deposit: PartnerNestRewardDepositRow; created: boolean }> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('partner_nest_reward_deposits')
    .insert({
      pool_id: input.pool_id,
      reward_mint: input.reward_mint.trim(),
      amount: input.amount,
      transaction_signature: input.transaction_signature.trim(),
      depositor_wallet: input.depositor_wallet.trim(),
    })
    .select('*')
    .single()

  if (error) {
    if (error.code === '23505') {
      const existing = await getPartnerNestRewardDepositBySignature(input.transaction_signature)
      if (existing) return { deposit: existing, created: false }
    }
    throw new Error(error.message)
  }
  return { deposit: mapRow(data as Record<string, unknown>), created: true }
}
