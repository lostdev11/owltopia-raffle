/**
 * Helpers for Partner Nesting: admin quick-create + approve-from-application payloads.
 */

import {
  buildQuickNftPoolDescription,
  isProbableSolanaPubkey,
  slugifyPoolSegment,
  suggestedNftPoolSlug,
} from '@/lib/nesting/admin-quick-pool'
import type { NftLockStandard } from '@/lib/db/staking-pools'

export type PartnerNestRewardMode = 'platform_owl' | 'partner_token'

export type PartnerNestCreateInput = {
  partnerLabel: string
  partnerSlug?: string | null
  collectionMint: string
  poolName?: string | null
  locked?: boolean
  maxLockDays?: number
  minLockDays?: number
  nftLockStandard?: NftLockStandard
  /** Default platform_owl (live OWL payouts). partner_token stores mint/symbol on the pool. */
  rewardMode?: PartnerNestRewardMode
  rewardTokenSymbol?: string | null
  rewardMint?: string | null
  rewardRate?: number
  rewardDecimals?: number | null
}

export type PartnerNestCreatePayload = {
  name: string
  slug: string
  description: string
  asset_type: 'nft'
  token_mint: null
  collection_key: string
  reward_token: string
  reward_mint: string | null
  reward_decimals: number | null
  reward_rate: number
  reward_rate_unit: 'daily'
  lock_period_days: number
  minimum_stake: null
  maximum_stake: null
  platform_fee_bps: 0
  display_order: 0
  is_active: true
  partner_project_slug: string
  nft_lock_standard: NftLockStandard
  adapter_mode: 'onchain_enabled' | 'mock'
  lock_enforcement_source: 'hybrid' | 'database'
  is_onchain_enabled: boolean
  requires_onchain_sync: false
}

export function partnerSlugFromLabel(label: string, fallbackWallet?: string | null): string {
  const fromLabel = slugifyPoolSegment(label)
  if (fromLabel && fromLabel !== 'pool') return fromLabel
  const wallet = fallbackWallet?.trim() ?? ''
  if (wallet.length >= 8) return `partner-${wallet.slice(0, 8).toLowerCase()}`
  return 'partner'
}

export function validatePartnerNestCreateInput(input: PartnerNestCreateInput): string | null {
  const label = input.partnerLabel.trim()
  if (!label) return 'Partner label is required.'

  const coll = input.collectionMint.trim()
  if (!coll) return 'Collection address is required.'
  if (!isProbableSolanaPubkey(coll)) {
    return 'Collection address does not look like a Solana public key.'
  }

  const standard = input.nftLockStandard ?? 'database_only'
  const locked = standard === 'database_only' ? false : input.locked === true

  if (standard === 'database_only' && input.locked === true) {
    return 'Soft nests (database_only) cannot use a freeze lock period.'
  }

  if (locked) {
    const maxLock = input.maxLockDays ?? 365
    const minLock = input.minLockDays ?? 30
    if (!Number.isFinite(maxLock) || !Number.isFinite(minLock)) {
      return 'Lock days must be valid numbers.'
    }
    if (!Number.isInteger(maxLock) || !Number.isInteger(minLock) || maxLock < 1 || minLock < 1) {
      return 'Lock days must be whole numbers of at least 1.'
    }
    if (minLock > maxLock) {
      return 'Minimum lock days cannot be greater than maximum lock days.'
    }
  }

  if (
    !['auto', 'mpl_core_freeze_delegate', 'spl_token_account_freeze', 'database_only'].includes(
      standard
    )
  ) {
    return 'Invalid NFT lock standard.'
  }

  const mode = input.rewardMode ?? 'platform_owl'
  if (mode === 'partner_token') {
    const mint = input.rewardMint?.trim() ?? ''
    if (!mint || !isProbableSolanaPubkey(mint)) {
      return 'Partner reward token mint is required and must be a Solana public key.'
    }
    const symbol = input.rewardTokenSymbol?.trim() ?? ''
    if (!symbol) return 'Partner reward token symbol is required.'
  }

  if (input.rewardRate != null) {
    const rate = Number(input.rewardRate)
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      return 'Reward rate must be between 0 and 100 per day.'
    }
  }

  return null
}

/** Build pool insert fields from partner onboarding / application approval. */
export function buildPartnerNestPoolPayload(input: PartnerNestCreateInput): PartnerNestCreatePayload {
  const err = validatePartnerNestCreateInput(input)
  if (err) throw new Error(err)

  const label = input.partnerLabel.trim()
  const coll = input.collectionMint.trim()
  const partnerSlug =
    (input.partnerSlug?.trim() && slugifyPoolSegment(input.partnerSlug)) ||
    partnerSlugFromLabel(label)
  const name = (input.poolName?.trim() || `${label} Nest`).slice(0, 80)
  const nftLockStandard: NftLockStandard = input.nftLockStandard ?? 'database_only'
  const locked = nftLockStandard === 'database_only' ? false : input.locked === true
  const maxLock = locked ? (input.maxLockDays ?? 365) : 0
  const minLock = locked ? (input.minLockDays ?? 30) : 0
  const onchain = nftLockStandard !== 'database_only'
  const mode = input.rewardMode ?? 'platform_owl'
  const rewardToken =
    mode === 'partner_token'
      ? (input.rewardTokenSymbol?.trim().toUpperCase() || 'TOKEN')
      : 'OWL'
  const rewardMint = mode === 'partner_token' ? input.rewardMint!.trim() : null
  const rewardRate =
    input.rewardRate != null && Number.isFinite(Number(input.rewardRate))
      ? Number(input.rewardRate)
      : 1
  const rewardDecimals =
    mode === 'partner_token' &&
    input.rewardDecimals != null &&
    Number.isInteger(Number(input.rewardDecimals))
      ? Number(input.rewardDecimals)
      : null

  return {
    name,
    slug: suggestedNftPoolSlug(name, coll),
    description: buildQuickNftPoolDescription({
      poolName: name,
      collectionMint: coll,
      locked,
      minLockDays: minLock,
      maxLockDays: maxLock,
    }),
    asset_type: 'nft',
    token_mint: null,
    collection_key: coll,
    reward_token: rewardToken,
    reward_mint: rewardMint,
    reward_decimals: rewardDecimals,
    reward_rate: rewardRate,
    reward_rate_unit: 'daily',
    lock_period_days: maxLock,
    minimum_stake: null,
    maximum_stake: null,
    platform_fee_bps: 0,
    display_order: 0,
    is_active: true,
    partner_project_slug: partnerSlug,
    nft_lock_standard: nftLockStandard,
    adapter_mode: onchain ? 'onchain_enabled' : 'mock',
    lock_enforcement_source: onchain ? 'hybrid' : 'database',
    is_onchain_enabled: onchain,
    requires_onchain_sync: false,
  }
}

export function isPartnerStakingPool(pool: {
  partner_project_slug?: string | null
}): boolean {
  return Boolean(pool.partner_project_slug?.trim())
}
