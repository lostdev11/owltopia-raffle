import { getSupabaseAdmin } from '@/lib/supabase-admin'

export type StakingRewardEventType = 'accrual' | 'claim' | 'adjustment'

export type StakingRewardExecutionPath = 'onchain_transfer' | 'database_only'

export interface StakingRewardEventRow {
  id: string
  position_id: string
  wallet_address: string
  event_type: StakingRewardEventType
  amount: number
  note: string | null
  transaction_signature: string | null
  execution_path: StakingRewardExecutionPath | null
  created_at: string
}

export async function listStakingRewardEventsByWallet(
  wallet: string,
  limit = 40
): Promise<StakingRewardEventRow[]> {
  const db = getSupabaseAdmin()
  const capped = Math.max(1, Math.min(limit, 100))
  const { data, error } = await db
    .from('staking_reward_events')
    .select(
      'id, position_id, wallet_address, event_type, amount, note, transaction_signature, execution_path, created_at'
    )
    .eq('wallet_address', wallet.trim())
    .eq('event_type', 'claim')
    .order('created_at', { ascending: false })
    .limit(capped)

  if (error) throw new Error(error.message)
  return (data || []) as StakingRewardEventRow[]
}
