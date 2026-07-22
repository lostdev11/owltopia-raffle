import { getSupabaseAdmin } from '@/lib/supabase-admin'
import type { RewardRateUnit } from '@/lib/db/staking-pools'
import type { StakingRewardExecutionPath } from '@/lib/db/staking-reward-events'

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

/** Active + pending nests for a pool (one row per NFT / stake unit). Server-only aggregate. */
export async function countOpenStakingPositionsForPool(poolId: string): Promise<number> {
  const db = getSupabaseAdmin()
  const { count, error } = await db
    .from('staking_positions')
    .select('id', { count: 'exact', head: true })
    .eq('pool_id', poolId.trim())
    .in('status', ['active', 'pending'])

  if (error) {
    console.error('[staking-positions] countOpenForPool:', error.message)
    return 0
  }
  return count ?? 0
}

/** Active + pending nests across multiple pools (e.g. Gen 1 90d+180d). Server-only aggregate. */
export async function countOpenStakingPositionsForPools(poolIds: string[]): Promise<number> {
  const ids = [...new Set(poolIds.map((id) => id.trim()).filter(Boolean))]
  if (ids.length === 0) return 0
  if (ids.length === 1) return countOpenStakingPositionsForPool(ids[0]!)

  const db = getSupabaseAdmin()
  const { count, error } = await db
    .from('staking_positions')
    .select('id', { count: 'exact', head: true })
    .in('pool_id', ids)
    .in('status', ['active', 'pending'])

  if (error) {
    console.error('[staking-positions] countOpenForPools:', error.message)
    return 0
  }
  return count ?? 0
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

export async function getActivePositionByAssetIdentifier(
  poolId: string,
  assetIdentifier: string
): Promise<StakingPositionRow | null> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('staking_positions')
    .select('*')
    .eq('pool_id', poolId)
    .eq('asset_identifier', assetIdentifier.trim())
    .in('status', ['active', 'pending'])
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
  sync_status?: PositionSyncStatus
  stake_signature?: string | null
  external_reference?: string | null
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
      sync_status: row.sync_status ?? undefined,
      stake_signature: row.stake_signature ?? undefined,
      external_reference: row.external_reference ?? undefined,
    })
    .select()
    .single()

  if (error) throw new Error(error.message)
  return data as StakingPositionRow
}

export async function getStakingPositionByStakeSignature(
  signature: string
): Promise<StakingPositionRow | null> {
  const sig = signature.trim()
  if (!sig) return null
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('staking_positions')
    .select('*')
    .eq('stake_signature', sig)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return data as StakingPositionRow | null
}

/**
 * `staking_positions_stake_signature_unique` allows each signature on at most one row
 * (token stake idempotency). Batch NFT nest locks share one wallet tx across many nests —
 * only the first row may store that signature; siblings keep their existing value or null.
 */
export async function resolveUniqueStakeSignatureForPosition(params: {
  positionId: string
  requestedSignature: string | null | undefined
  existingSignature: string | null | undefined
}): Promise<string | null> {
  const existing = params.existingSignature?.trim() || null
  const requested = params.requestedSignature?.trim() || null
  const candidate = requested || existing
  if (!candidate) return null

  const owner = await getStakingPositionByStakeSignature(candidate)
  if (!owner || owner.id === params.positionId) return candidate
  return existing
}

export function isStakeSignatureUniqueViolation(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error ?? '')
  return (
    msg.includes('staking_positions_stake_signature_unique') ||
    (msg.toLowerCase().includes('duplicate key') && msg.includes('stake_signature'))
  )
}

export async function markPositionUnstaked(
  positionId: string,
  wallet: string,
  extraPatch: Partial<StakingPositionSyncPatch> & Record<string, unknown> = {}
): Promise<StakingPositionRow> {
  const db = getSupabaseAdmin()
  const now = new Date().toISOString()
  const { data, error } = await db
    .from('staking_positions')
    .update({
      status: 'unstaked',
      unstaked_at: now,
      ...extraPatch,
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
  execution_path?: StakingRewardExecutionPath | null
}): Promise<void> {
  const db = getSupabaseAdmin()
  const txSig = params.transaction_signature?.trim() || null
  const executionPath: StakingRewardExecutionPath | null =
    params.execution_path ?? (txSig ? 'onchain_transfer' : params.note === 'db_only_owl_claim' ? 'database_only' : null)

  const { error } = await db.rpc('staking_record_reward_claim', {
    p_position_id: params.positionId,
    p_wallet: params.wallet.trim(),
    p_amount: params.amount,
    p_new_claimed_total: params.newClaimedTotal,
    p_note: params.note ?? null,
    p_transaction_signature: txSig,
    p_execution_path: executionPath,
  })

  if (error) {
    throw mapStakingRewardClaimRpcError(error.message)
  }
}

export type BatchRewardClaimItem = {
  position_id: string
  amount: number
  new_claimed_total: number
}

export async function recordBatchRewardClaims(params: {
  wallet: string
  items: BatchRewardClaimItem[]
  note?: string | null
  transaction_signature?: string | null
  execution_path?: StakingRewardExecutionPath | null
}): Promise<{ recorded_count: number; idempotent_count: number; item_count: number }> {
  if (params.items.length === 0) {
    return { recorded_count: 0, idempotent_count: 0, item_count: 0 }
  }

  const db = getSupabaseAdmin()
  const txSig = params.transaction_signature?.trim() || null
  const executionPath: StakingRewardExecutionPath | null =
    params.execution_path ?? (txSig ? 'onchain_transfer' : params.note === 'db_only_owl_claim' ? 'database_only' : null)

  const { data, error } = await db.rpc('staking_record_batch_reward_claim', {
    p_wallet: params.wallet.trim(),
    p_items: params.items.map((item) => ({
      position_id: item.position_id,
      amount: item.amount,
      new_claimed_total: item.new_claimed_total,
    })),
    p_note: params.note ?? null,
    p_transaction_signature: txSig,
    p_execution_path: executionPath,
  })

  if (error) {
    throw mapStakingRewardClaimRpcError(error.message)
  }

  const row = (data ?? {}) as Record<string, unknown>
  return {
    recorded_count: Number(row.recorded_count ?? 0),
    idempotent_count: Number(row.idempotent_count ?? 0),
    item_count: Number(row.item_count ?? params.items.length),
  }
}

function mapStakingRewardClaimRpcError(msg: string | undefined): Error {
  const text = msg ?? ''
  if (text.includes('duplicate_tx')) {
    return new Error('This claim transaction was already recorded.')
  }
  if (text.includes('position_not_found')) {
    return new Error('Position not found')
  }
  return new Error(text || 'Failed to record reward claim')
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
