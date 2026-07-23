/**
 * Admin nest roster groups: Owltopia coins + Gen 1 / Gen 2 owl tiers.
 * Kept separate from GenOwlStakingGroupKey so rev-share / perch grouping stay Gen Owl–only.
 */
import {
  GEN1_OWL_STAKING_POOL_SLUGS,
  GEN2_OWL_STAKING_POOL_SLUGS,
} from '@/lib/nesting/gen1-staking-pools'
import { OWL_NEST_365_SLUG } from '@/lib/nesting/owl-nest-365-stats'
import type { SupportNestFamilyKey } from '@/lib/nesting/support-nest-pools'

export type NestRosterGroupKey = SupportNestFamilyKey

export const NEST_ROSTER_GROUP_KEYS: readonly NestRosterGroupKey[] = [
  'owl-nest-coins',
  'gen1-owl',
  'gen2-owl',
] as const

export const NEST_ROSTER_GROUP_SLUGS: Record<NestRosterGroupKey, readonly string[]> = {
  'owl-nest-coins': [OWL_NEST_365_SLUG],
  'gen1-owl': GEN1_OWL_STAKING_POOL_SLUGS,
  'gen2-owl': GEN2_OWL_STAKING_POOL_SLUGS,
}

export function resolveNestRosterGroupKey(
  value: string | null | undefined
): NestRosterGroupKey | null {
  const v = value?.trim().toLowerCase()
  if (!v) return null
  if (
    v === 'owl-nest-coins' ||
    v === 'owl-nest-365' ||
    v === 'coins' ||
    v === 'coin' ||
    v === 'owltopia-coins' ||
    v === 'owltopia-coin'
  ) {
    return 'owl-nest-coins'
  }
  if (v === 'gen1-owl' || v === 'gen1') return 'gen1-owl'
  if (v === 'gen2-owl' || v === 'gen2') return 'gen2-owl'
  return null
}

/** Toggle / CSV label for a nest roster group. */
export function nestRosterGroupLabel(key: NestRosterGroupKey): string {
  if (key === 'owl-nest-coins') return 'Owltopia coin NFTs'
  if (key === 'gen1-owl') return 'Gen 1 Owl'
  return 'Gen 2 Owl'
}
