/**
 * Partner Nesting applications — self-serve collection + optional reward token requests.
 * Admins approve (provision staking_pools) or reject.
 */

import { getSupabaseAdmin } from '@/lib/supabase-admin'
import {
  getPartnerCommunityCreatorByWallet,
} from '@/lib/db/partner-community-creators-admin'
import { insertStakingPool, type NftLockStandard, type StakingPoolRow } from '@/lib/db/staking-pools'
import {
  buildPartnerNestPoolPayload,
  partnerSlugFromLabel,
  validatePartnerNestCreateInput,
} from '@/lib/nesting/partner-nest-pool'
import { validatePoolAgainstNestingEmissionPolicy } from '@/lib/nesting/policy'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'
import { isProbableSolanaPubkey } from '@/lib/nesting/admin-quick-pool'

export type PartnerNestRewardMode = 'platform_owl' | 'partner_token'
export type PartnerNestApplicationStatus = 'new' | 'contacted' | 'active' | 'closed'

export type PartnerNestApplicationRow = {
  id: number
  creator_wallet: string
  collection_key: string
  pool_name: string | null
  partner_slug: string | null
  locked: boolean
  max_lock_days: number
  min_lock_days: number
  nft_lock_standard: string
  reward_mode_requested: PartnerNestRewardMode | string
  reward_token_symbol: string | null
  reward_mint: string | null
  reward_decimals: number | null
  reward_rate: number
  reward_rate_unit: string
  notes: string | null
  status: PartnerNestApplicationStatus | string
  rejection_reason: string | null
  approved_at: string | null
  approved_pool_id: string | null
  approved_reward_mode: PartnerNestRewardMode | string | null
  reviewed_by: string | null
  created_at: string
  updated_at: string
}

const VALID_STATUSES = new Set(['new', 'contacted', 'active', 'closed'])
const VALID_REWARD_MODES = new Set(['platform_owl', 'partner_token'])

export function validatePartnerNestApplicationInput(input: {
  collection_key: string
  reward_mode_requested?: string | null
  reward_token_symbol?: string | null
  reward_mint?: string | null
  reward_decimals?: number | null
  reward_rate?: number | null
  locked?: boolean
  max_lock_days?: number
  min_lock_days?: number
  nft_lock_standard?: string | null
}): string | null {
  const coll = input.collection_key.trim()
  if (!coll) return 'Collection address is required.'
  if (!isProbableSolanaPubkey(coll)) {
    return 'Collection address does not look like a Solana public key.'
  }

  const mode = (input.reward_mode_requested ?? 'platform_owl').trim()
  if (!VALID_REWARD_MODES.has(mode)) {
    return 'reward_mode_requested must be platform_owl or partner_token.'
  }

  if (mode === 'partner_token') {
    const mint = input.reward_mint?.trim() ?? ''
    if (!mint) return 'Partner reward token mint is required when requesting partner_token rewards.'
    if (!isProbableSolanaPubkey(mint)) {
      return 'Reward token mint does not look like a Solana public key.'
    }
    const symbol = input.reward_token_symbol?.trim() ?? ''
    if (!symbol) return 'Reward token symbol is required when requesting partner_token rewards.'
    if (symbol.length > 16) return 'Reward token symbol must be 16 characters or fewer.'
    if (input.reward_decimals != null) {
      const d = Number(input.reward_decimals)
      if (!Number.isInteger(d) || d < 0 || d > 18) {
        return 'Reward decimals must be an integer from 0 to 18.'
      }
    }
  }

  const locked = input.locked !== false
  if (locked) {
    const maxLock = input.max_lock_days ?? 90
    const minLock = input.min_lock_days ?? 30
    if (!Number.isInteger(maxLock) || !Number.isInteger(minLock) || maxLock < 1 || minLock < 1) {
      return 'Lock days must be whole numbers of at least 1.'
    }
    if (minLock > maxLock) return 'Minimum lock days cannot be greater than maximum lock days.'
  }

  const standard = (input.nft_lock_standard ?? 'auto').trim()
  if (!['auto', 'mpl_core_freeze_delegate', 'spl_token_account_freeze'].includes(standard)) {
    return 'Invalid NFT lock standard.'
  }

  const rate = input.reward_rate ?? 1
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
    return 'Reward rate must be a number between 0 and 100 (per day).'
  }

  return null
}

export async function insertPartnerNestApplication(input: {
  creator_wallet: string
  collection_key: string
  pool_name?: string | null
  partner_slug?: string | null
  locked?: boolean
  max_lock_days?: number
  min_lock_days?: number
  nft_lock_standard?: string
  reward_mode_requested?: PartnerNestRewardMode
  reward_token_symbol?: string | null
  reward_mint?: string | null
  reward_decimals?: number | null
  reward_rate?: number
  reward_rate_unit?: 'hourly' | 'daily' | 'weekly'
  notes?: string | null
}): Promise<PartnerNestApplicationRow> {
  const wallet = normalizeSolanaWalletAddress(input.creator_wallet)
  if (!wallet) throw new Error('creator_wallet must be a valid Solana address')

  const partner = await getPartnerCommunityCreatorByWallet(wallet)
  if (!partner || !partner.is_active) {
    throw new Error('Only active partner program creators can request Nesting.')
  }

  const validationError = validatePartnerNestApplicationInput({
    collection_key: input.collection_key,
    reward_mode_requested: input.reward_mode_requested,
    reward_token_symbol: input.reward_token_symbol,
    reward_mint: input.reward_mint,
    reward_decimals: input.reward_decimals,
    reward_rate: input.reward_rate,
    locked: input.locked,
    max_lock_days: input.max_lock_days,
    min_lock_days: input.min_lock_days,
    nft_lock_standard: input.nft_lock_standard,
  })
  if (validationError) throw new Error(validationError)

  const mode: PartnerNestRewardMode = input.reward_mode_requested ?? 'platform_owl'
  const sb = getSupabaseAdmin()
  const { data, error } = await sb
    .from('partner_nest_applications')
    .insert({
      creator_wallet: wallet,
      collection_key: input.collection_key.trim(),
      pool_name: input.pool_name?.trim() || null,
      partner_slug: input.partner_slug?.trim() || null,
      locked: input.locked !== false,
      max_lock_days: input.max_lock_days ?? 90,
      min_lock_days: input.min_lock_days ?? 30,
      nft_lock_standard: input.nft_lock_standard ?? 'auto',
      reward_mode_requested: mode,
      reward_token_symbol:
        mode === 'partner_token' ? input.reward_token_symbol?.trim().toUpperCase() || null : null,
      reward_mint: mode === 'partner_token' ? input.reward_mint?.trim() || null : null,
      reward_decimals: mode === 'partner_token' ? (input.reward_decimals ?? null) : null,
      reward_rate: input.reward_rate ?? 1,
      reward_rate_unit: input.reward_rate_unit ?? 'daily',
      notes: input.notes?.trim() || null,
      status: 'new',
    })
    .select('*')
    .single()

  if (error) throw new Error(error.message)
  return data as PartnerNestApplicationRow
}

export async function listPartnerNestApplicationsByWallet(
  creatorWallet: string
): Promise<PartnerNestApplicationRow[]> {
  const wallet = normalizeSolanaWalletAddress(creatorWallet)
  if (!wallet) return []
  const sb = getSupabaseAdmin()
  const { data, error } = await sb
    .from('partner_nest_applications')
    .select('*')
    .eq('creator_wallet', wallet)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as PartnerNestApplicationRow[]
}

export async function listPartnerNestApplicationsAdmin(): Promise<PartnerNestApplicationRow[]> {
  const sb = getSupabaseAdmin()
  const { data, error } = await sb
    .from('partner_nest_applications')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as PartnerNestApplicationRow[]
}

export async function getPartnerNestApplicationById(
  id: number
): Promise<PartnerNestApplicationRow | null> {
  const sb = getSupabaseAdmin()
  const { data, error } = await sb
    .from('partner_nest_applications')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as PartnerNestApplicationRow | null) ?? null
}

export async function updatePartnerNestApplicationStatus(
  id: number,
  status: PartnerNestApplicationStatus,
  opts?: { rejection_reason?: string | null; reviewed_by?: string | null }
): Promise<PartnerNestApplicationRow> {
  if (!VALID_STATUSES.has(status)) throw new Error('Invalid status')
  const sb = getSupabaseAdmin()
  const patch: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  }
  if (opts?.rejection_reason !== undefined) {
    patch.rejection_reason = opts.rejection_reason?.trim() || null
  }
  if (opts?.reviewed_by !== undefined) {
    patch.reviewed_by = opts.reviewed_by?.trim() || null
  }
  if (status === 'closed' && !opts?.rejection_reason) {
    // keep existing reason if any
  }
  const { data, error } = await sb
    .from('partner_nest_applications')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return data as PartnerNestApplicationRow
}

export type ApprovePartnerNestApplicationResult = {
  application: PartnerNestApplicationRow
  pool: StakingPoolRow
}

/**
 * Approve → create partner staking pool from application.
 * reward_mode: platform_owl (default, live OWL payouts) or partner_token (stores mint; payouts need funding later).
 */
export async function approvePartnerNestApplication(params: {
  id: number
  reviewed_by: string
  reward_mode?: PartnerNestRewardMode
}): Promise<ApprovePartnerNestApplicationResult> {
  const app = await getPartnerNestApplicationById(params.id)
  if (!app) throw new Error('Application not found')

  const partner = await getPartnerCommunityCreatorByWallet(app.creator_wallet)
  if (!partner || !partner.is_active) {
    throw new Error('Partner creator is missing or inactive. Reactivate them before approving Nesting.')
  }

  const rewardMode: PartnerNestRewardMode =
    params.reward_mode ??
    (app.reward_mode_requested === 'partner_token' ? 'partner_token' : 'platform_owl')

  if (rewardMode === 'partner_token') {
    if (!app.reward_mint?.trim() || !app.reward_token_symbol?.trim()) {
      throw new Error(
        'Cannot approve as partner_token: application is missing reward mint or symbol. Approve as platform_owl or ask them to resubmit.'
      )
    }
  }

  const label =
    partner.display_label?.trim() ||
    app.pool_name?.trim().replace(/\s+nest$/i, '') ||
    app.creator_wallet.slice(0, 8)

  const createInput = {
    partnerLabel: label,
    partnerSlug: app.partner_slug || partnerSlugFromLabel(label, app.creator_wallet),
    collectionMint: app.collection_key,
    poolName: app.pool_name,
    locked: app.locked,
    maxLockDays: app.max_lock_days,
    minLockDays: app.min_lock_days,
    nftLockStandard: app.nft_lock_standard as NftLockStandard,
    rewardMode,
    rewardTokenSymbol: app.reward_token_symbol,
    rewardMint: app.reward_mint,
    rewardRate: Number(app.reward_rate) || 1,
    rewardDecimals: app.reward_decimals,
  }

  const validationError = validatePartnerNestCreateInput(createInput)
  if (validationError) throw new Error(validationError)

  const payload = buildPartnerNestPoolPayload(createInput)

  validatePoolAgainstNestingEmissionPolicy({
    asset_type: payload.asset_type,
    reward_token: payload.reward_token,
    reward_rate: payload.reward_rate,
    reward_rate_unit: payload.reward_rate_unit,
    partner_project_slug: payload.partner_project_slug,
    reward_mint: payload.reward_mint ?? null,
  })

  const pool = await insertStakingPool({
    ...payload,
    created_by: params.reviewed_by,
  })

  const now = new Date().toISOString()
  const sb = getSupabaseAdmin()
  const { data, error } = await sb
    .from('partner_nest_applications')
    .update({
      status: 'active',
      approved_at: now,
      approved_pool_id: pool.id,
      approved_reward_mode: rewardMode,
      reviewed_by: params.reviewed_by,
      rejection_reason: null,
      updated_at: now,
    })
    .eq('id', params.id)
    .select('*')
    .single()

  if (error) throw new Error(error.message)

  return {
    application: data as PartnerNestApplicationRow,
    pool,
  }
}
