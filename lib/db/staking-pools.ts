import { getSupabaseAdmin, getSupabaseForServerRead } from '@/lib/supabase-admin'
import { supabase } from '@/lib/supabase'

export type StakingAssetType = 'nft' | 'token'
export type RewardRateUnit = 'hourly' | 'daily' | 'weekly'

/** Application execution mode for this pool (migration 080). */
export type NestingAdapterMode = 'mock' | 'solana_ready' | 'onchain_enabled'

/** Where lock/unlock rules are enforced once on-chain staking ships. */
export type LockEnforcementSource = 'database' | 'onchain' | 'hybrid'

export interface StakingPoolRow {
  id: string
  name: string
  slug: string
  description: string
  asset_type: StakingAssetType
  token_mint: string | null
  collection_key: string | null
  reward_token: string | null
  reward_rate: number
  reward_rate_unit: RewardRateUnit
  lock_period_days: number
  minimum_stake: number | null
  maximum_stake: number | null
  platform_fee_bps: number
  is_active: boolean
  display_order: number
  partner_project_slug: string | null
  created_by: string
  created_at: string
  updated_at: string
  /** Present once migration `080_owl_nesting_onchain_readiness` is applied. */
  adapter_mode?: NestingAdapterMode
  is_onchain_enabled?: boolean
  program_id?: string | null
  program_pool_address?: string | null
  vault_address?: string | null
  stake_mint?: string | null
  reward_mint?: string | null
  requires_onchain_sync?: boolean
  lock_enforcement_source?: LockEnforcementSource
}

export async function listActiveStakingPools(): Promise<StakingPoolRow[]> {
  const db = getSupabaseForServerRead(supabase)
  const { data, error } = await db
    .from('staking_pools')
    .select('*')
    .eq('is_active', true)
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) {
    console.error('[staking-pools] listActive:', error.message)
    return []
  }
  return (data || []) as StakingPoolRow[]
}

export async function listAllStakingPoolsAdmin(): Promise<StakingPoolRow[]> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('staking_pools')
    .select('*')
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) throw new Error(error.message)
  return (data || []) as StakingPoolRow[]
}

export async function getStakingPoolById(id: string): Promise<StakingPoolRow | null> {
  const db = getSupabaseAdmin()
  const { data, error } = await db.from('staking_pools').select('*').eq('id', id).maybeSingle()

  if (error) throw new Error(error.message)
  return data as StakingPoolRow | null
}

export interface InsertStakingPoolInput {
  name: string
  slug: string
  description: string
  asset_type: StakingAssetType
  token_mint?: string | null
  collection_key?: string | null
  reward_token?: string | null
  reward_rate?: number
  reward_rate_unit?: RewardRateUnit
  lock_period_days?: number
  minimum_stake?: number | null
  maximum_stake?: number | null
  platform_fee_bps?: number
  is_active?: boolean
  display_order?: number
  partner_project_slug?: string | null
  created_by: string
  adapter_mode?: NestingAdapterMode
  is_onchain_enabled?: boolean
  program_id?: string | null
  program_pool_address?: string | null
  vault_address?: string | null
  stake_mint?: string | null
  reward_mint?: string | null
  requires_onchain_sync?: boolean
  lock_enforcement_source?: LockEnforcementSource
}

export async function insertStakingPool(input: InsertStakingPoolInput): Promise<StakingPoolRow> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('staking_pools')
    .insert({
      name: input.name.trim(),
      slug: input.slug.trim().toLowerCase(),
      description: input.description.trim(),
      asset_type: input.asset_type,
      token_mint: input.token_mint?.trim() || null,
      collection_key: input.collection_key?.trim() || null,
      reward_token: input.reward_token?.trim() || null,
      reward_rate: input.reward_rate ?? 0,
      reward_rate_unit: input.reward_rate_unit ?? 'daily',
      lock_period_days: input.lock_period_days ?? 0,
      minimum_stake: input.minimum_stake ?? null,
      maximum_stake: input.maximum_stake ?? null,
      platform_fee_bps: input.platform_fee_bps ?? 0,
      is_active: input.is_active ?? true,
      display_order: input.display_order ?? 0,
      partner_project_slug: input.partner_project_slug?.trim() || null,
      created_by: input.created_by,
      adapter_mode: input.adapter_mode ?? 'mock',
      is_onchain_enabled: input.is_onchain_enabled ?? false,
      program_id: input.program_id?.trim() || null,
      program_pool_address: input.program_pool_address?.trim() || null,
      vault_address: input.vault_address?.trim() || null,
      stake_mint: input.stake_mint?.trim() || null,
      reward_mint: input.reward_mint?.trim() || null,
      requires_onchain_sync: input.requires_onchain_sync ?? false,
      lock_enforcement_source: input.lock_enforcement_source ?? 'database',
    })
    .select()
    .single()

  if (error) throw new Error(error.message)
  return data as StakingPoolRow
}

export interface PatchStakingPoolInput {
  name?: string
  slug?: string
  description?: string
  asset_type?: StakingAssetType
  token_mint?: string | null
  collection_key?: string | null
  reward_token?: string | null
  reward_rate?: number
  reward_rate_unit?: RewardRateUnit
  lock_period_days?: number
  minimum_stake?: number | null
  maximum_stake?: number | null
  platform_fee_bps?: number
  is_active?: boolean
  display_order?: number
  partner_project_slug?: string | null
  adapter_mode?: NestingAdapterMode
  is_onchain_enabled?: boolean
  program_id?: string | null
  program_pool_address?: string | null
  vault_address?: string | null
  stake_mint?: string | null
  reward_mint?: string | null
  requires_onchain_sync?: boolean
  lock_enforcement_source?: LockEnforcementSource
}

export async function updateStakingPool(id: string, patch: PatchStakingPoolInput): Promise<StakingPoolRow> {
  const db = getSupabaseAdmin()
  const row: Record<string, unknown> = {}
  if (patch.name !== undefined) row.name = patch.name.trim()
  if (patch.slug !== undefined) row.slug = patch.slug.trim().toLowerCase()
  if (patch.description !== undefined) row.description = patch.description.trim()
  if (patch.asset_type !== undefined) row.asset_type = patch.asset_type
  if (patch.token_mint !== undefined) row.token_mint = patch.token_mint?.trim() || null
  if (patch.collection_key !== undefined) row.collection_key = patch.collection_key?.trim() || null
  if (patch.reward_token !== undefined) row.reward_token = patch.reward_token?.trim() || null
  if (patch.reward_rate !== undefined) row.reward_rate = patch.reward_rate
  if (patch.reward_rate_unit !== undefined) row.reward_rate_unit = patch.reward_rate_unit
  if (patch.lock_period_days !== undefined) row.lock_period_days = patch.lock_period_days
  if (patch.minimum_stake !== undefined) row.minimum_stake = patch.minimum_stake
  if (patch.maximum_stake !== undefined) row.maximum_stake = patch.maximum_stake
  if (patch.platform_fee_bps !== undefined) row.platform_fee_bps = patch.platform_fee_bps
  if (patch.is_active !== undefined) row.is_active = patch.is_active
  if (patch.display_order !== undefined) row.display_order = patch.display_order
  if (patch.partner_project_slug !== undefined) row.partner_project_slug = patch.partner_project_slug?.trim() || null
  if (patch.adapter_mode !== undefined) row.adapter_mode = patch.adapter_mode
  if (patch.is_onchain_enabled !== undefined) row.is_onchain_enabled = patch.is_onchain_enabled
  if (patch.program_id !== undefined) row.program_id = patch.program_id?.trim() || null
  if (patch.program_pool_address !== undefined) row.program_pool_address = patch.program_pool_address?.trim() || null
  if (patch.vault_address !== undefined) row.vault_address = patch.vault_address?.trim() || null
  if (patch.stake_mint !== undefined) row.stake_mint = patch.stake_mint?.trim() || null
  if (patch.reward_mint !== undefined) row.reward_mint = patch.reward_mint?.trim() || null
  if (patch.requires_onchain_sync !== undefined) row.requires_onchain_sync = patch.requires_onchain_sync
  if (patch.lock_enforcement_source !== undefined) row.lock_enforcement_source = patch.lock_enforcement_source

  const { data, error } = await db.from('staking_pools').update(row).eq('id', id).select().single()

  if (error) throw new Error(error.message)
  return data as StakingPoolRow
}
