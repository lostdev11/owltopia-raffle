/**
 * Helpers for the admin “Partner Nesting” tool: create NFT stake perches
 * bound to a partner community creator + collection mint.
 */

import {
  buildQuickNftPoolDescription,
  isProbableSolanaPubkey,
  slugifyPoolSegment,
  suggestedNftPoolSlug,
} from '@/lib/nesting/admin-quick-pool'
import type { NftLockStandard } from '@/lib/db/staking-pools'

export type PartnerNestCreateInput = {
  partnerLabel: string
  partnerSlug?: string | null
  collectionMint: string
  poolName?: string | null
  locked?: boolean
  maxLockDays?: number
  minLockDays?: number
  nftLockStandard?: NftLockStandard
}

export type PartnerNestCreatePayload = {
  name: string
  slug: string
  description: string
  asset_type: 'nft'
  token_mint: null
  collection_key: string
  reward_token: 'OWL'
  reward_rate: 1
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

  const locked = input.locked !== false
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

  const standard = input.nftLockStandard ?? 'auto'
  if (standard === 'database_only') {
    return 'Partner nesting requires an on-chain freeze standard (auto, Core, or SPL) — not preview/database_only.'
  }

  return null
}

/** Build the POST body for /api/admin/staking/pools from partner onboarding fields. */
export function buildPartnerNestPoolPayload(input: PartnerNestCreateInput): PartnerNestCreatePayload {
  const err = validatePartnerNestCreateInput(input)
  if (err) throw new Error(err)

  const label = input.partnerLabel.trim()
  const coll = input.collectionMint.trim()
  const partnerSlug =
    (input.partnerSlug?.trim() && slugifyPoolSegment(input.partnerSlug)) ||
    partnerSlugFromLabel(label)
  const name = (input.poolName?.trim() || `${label} Nest`).slice(0, 80)
  const locked = input.locked !== false
  const maxLock = locked ? (input.maxLockDays ?? 365) : 0
  const minLock = locked ? (input.minLockDays ?? 30) : 0
  const nftLockStandard: NftLockStandard = input.nftLockStandard ?? 'auto'
  const onchain = nftLockStandard !== 'database_only'

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
    reward_token: 'OWL',
    reward_rate: 1,
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
