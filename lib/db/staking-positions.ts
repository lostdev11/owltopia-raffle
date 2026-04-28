import { getSupabaseAdmin } from '@/lib/supabase-admin'
import type { RewardRateUnit } from '@/lib/db/staking-pools'

export type StakingPositionStatus = 'active' | 'unstaked' | 'pending'

/** Sync state for Supabase read model vs on-chain (migration 080). */
export type PositionSyncStatus = 'pending' | 'confirmed' | 'failed' | 'stale' | 'synced'

export interface StakingPositionRow {
  id: string
  wallet_address: string
  pool_id: string
  asset_identifier: string | null
  amount: number
  reward_rate_snapshot: number
  reward_rate_unit_snapshot: RewardRateUnit
  reward_token_snapshot: string | null
  staked_at: string
  unlock_at: string | null
  unstaked_at: string | null
  claimed_rewards: number
  status: StakingPositionStatus
  created_at: string
  updated_at: string
  /** Present once migration `080_owl_nesting_onchain_readiness` is applied. */
  onchain_position_address?: string | null
  stake_signature?: string | null
  unstake_signature?: string | null
  last_claim_signature?: string | null
  sync_status?: PositionSyncStatus
  last_synced_at?: string | null
  last_transaction_error?: string | null
  external_reference?: string | null
}

export async function listStakingPositionsByWallet(wallet: string): Promise<StakingPositionRow[]> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('staking_positions')
    .select('*')
    .eq('wallet_address', wallet.trim())
    .order('staked_at', { ascending: false })

  if (error) throw new Error(error.message)
  return (data || []) as StakingPositionRow[]
}

/** Server-only lookup by id (no wallet filter). */
export async function getStakingPositionById(positionId: string): Promise<StakingPositionRow | null> {
  const db = getSupabaseAdmin()
  const { data, error } = await db.from('staking_positions').select('*').eq('id', positionId).maybeSingle()

  if (error) throw new Error(error.message)
  return data as StakingPositionRow | null
}

export async function getStakingPositionForWallet(
  positionId: string,
  wallet: string
): Promise<StakingPositionRow | null> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('staking_positions')
    .select('*')
    .eq('id', positionId)
    .eq('wallet_address', wallet.trim())
    .maybeSingle()

  if (error) throw new Error(error.message)
  return data as StakingPositionRow | null
}

export async function insertStakingPosition(row: {
  wallet_address: string
  pool_id: string
  asset_identifier: string | null
  amount: number
  reward_rate_snapshot: number
  reward_rate_unit_snapshot: RewardRateUnit
  reward_token_snapshot: string | null
  staked_at: string
  unlock_at: string | null
  status: StakingPositionStatus
}): Promise<StakingPositionRow> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('staking_positions')
    .insert({
      wallet_address: row.wallet_address.trim(),
      pool_id: row.pool_id,
      asset_identifier: row.asset_identifier,
      amount: row.amount,
      reward_rate_snapshot: row.reward_rate_snapshot,
      reward_rate_unit_snapshot: row.reward_rate_unit_snapshot,
      reward_token_snapshot: row.reward_token_snapshot,
      staked_at: row.staked_at,
      unlock_at: row.unlock_at,
      claimed_rewards: 0,
      status: row.status,
    })
    .select()
    .single()

  if (error) throw new Error(error.message)
  return data as StakingPositionRow
}

export async function markPositionUnstaked(positionId: string, wallet: string): Promise<StakingPositionRow> {
  const db = getSupabaseAdmin()
  const now = new Date().toISOString()
  const { data, error } = await db
    .from('staking_positions')
    .update({
      status: 'unstaked',
      unstaked_at: now,
    })
    .eq('id', positionId)
    .eq('wallet_address', wallet.trim())
    .select()
    .single()

  if (error) throw new Error(error.message)
  return data as StakingPositionRow
}

export async function recordRewardClaim(params: {
  positionId: string
  wallet: string
  amount: number
  newClaimedTotal: number
  note?: string | null
  transaction_signature?: string | null
  last_claim_signature?: string | null
}): Promise<void> {
  const db = getSupabaseAdmin()
  const posUpdate: Record<string, unknown> = { claimed_rewards: params.newClaimedTotal }
  if (params.last_claim_signature !== undefined) {
    posUpdate.last_claim_signature = params.last_claim_signature
  }

  const { error: uErr } = await db
    .from('staking_positions')
    .update(posUpdate)
    .eq('id', params.positionId)
    .eq('wallet_address', params.wallet.trim())

  if (uErr) throw new Error(uErr.message)

  const { error: eErr } = await db.from('staking_reward_events').insert({
    position_id: params.positionId,
    wallet_address: params.wallet.trim(),
    event_type: 'claim',
    amount: params.amount,
    note: params.note ?? null,
    transaction_signature: params.transaction_signature ?? null,
  })

  if (eErr) throw new Error(eErr.message)
}

/** Positions that may need a one-off `getTransaction` re-check (bounded batch; no polling). */
export async function listStakingPositionsForReconciliation(
  limit: number
): Promise<StakingPositionRow[]> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('staking_positions')
    .select('*')
    .in('sync_status', ['pending', 'stale'])
    .order('updated_at', { ascending: true })
    .limit(Math.max(1, Math.min(limit, 100)))

  if (error) throw new Error(error.message)
  return (data || []) as StakingPositionRow[]
}

export type StakingPositionSyncPatch = Pick<
  StakingPositionRow,
  | 'sync_status'
  | 'last_synced_at'
  | 'last_transaction_error'
  | 'stake_signature'
  | 'unstake_signature'
  | 'last_claim_signature'
  | 'onchain_position_address'
  | 'external_reference'
>

export async function patchStakingPosition(
  positionId: string,
  patch: Partial<StakingPositionSyncPatch> & Record<string, unknown>
): Promise<StakingPositionRow> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('staking_positions')
    .update(patch)
    .eq('id', positionId)
    .select()
    .single()

  if (error) throw new Error(error.message)
  return data as StakingPositionRow
}
