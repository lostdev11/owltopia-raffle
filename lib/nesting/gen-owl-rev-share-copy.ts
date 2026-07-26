import type { GenOwlStakingGroupKey } from '@/lib/nesting/gen-owl-staking-groups'

/** Share of the Gen 1 nest pool allocated to all staked Gen 1 owls (non-1/1). */
export const GEN1_REV_SHARE_STANDARD_POOL_FRACTION = 0.9

/** Share of the Gen 1 nest pool allocated to staked Gen 1 1/1 owls. */
export const GEN1_REV_SHARE_ONE_OF_ONE_POOL_FRACTION = 0.1

export function genOwlRevShareDistributionHeadline(group: GenOwlStakingGroupKey): string {
  if (group === 'gen1-owl') {
    return '90% all staked · 10% 1/1 · claim after month ends'
  }
  return 'Even split · claim after month ends'
}

/** Short blurb for estimate / claim panels (mobile-first). */
export const GEN_OWL_REV_SHARE_SHORT_BLURB =
  'Estimate from this month’s pool. Finals lock at month-end; claim opens the 1st (UTC).'

export function genOwlRevShareDistributionSummary(group: GenOwlStakingGroupKey): string {
  if (group === 'gen1-owl') {
    return 'Gen 1: 90% split across all nests · 10% across 1/1s.'
  }
  return 'Gen 2: split evenly across your nests.'
}

export function genOwlRevShareDistributionDetail(group: GenOwlStakingGroupKey): string {
  if (group === 'gen1-owl') {
    return 'Gen 1 pool: 90% split evenly across all staked Gen 1 owls; 10% split evenly across staked Gen 1 1/1s. Claim opens on the 1st of the next month (UTC).'
  }
  return 'Split evenly across eligible nests at month-end. Claim opens on the 1st of the next month (UTC).'
}

export function genOwlRevShareAdminDistributionNote(group: GenOwlStakingGroupKey): string {
  if (group === 'gen1-owl') {
    return 'Total SOL/USDC for Gen 1 owl stakers — 90% divided evenly across all staked Gen 1 owls; 10% divided evenly across staked Gen 1 1/1s (90d and 180d tiers combined).'
  }
  return 'Separate pool for Gen 2 owl stakers — even split across active Gen 2 nests.'
}

export function genOwlRevShareGroupLabel(
  group: GenOwlStakingGroupKey,
  bucket: 'standard' | 'one_of_one' | null | undefined
): string {
  if (group === 'gen1-owl') {
    return bucket === 'one_of_one' ? 'Gen 1 1/1' : 'Gen 1'
  }
  return 'Gen 2'
}
