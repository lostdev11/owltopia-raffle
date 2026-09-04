import type { GenOwlStakingGroupKey } from '@/lib/nesting/gen-owl-staking-groups'

/** Share of a Gen nest pool divided evenly across ALL staked owls in that gen (including 1/1s). */
export const GEN_OWL_REV_SHARE_STANDARD_POOL_FRACTION = 0.9

/** Bonus share of a Gen nest pool divided evenly across staked 1/1s (on top of the 90%). */
export const GEN_OWL_REV_SHARE_ONE_OF_ONE_POOL_FRACTION = 0.1

/** @deprecated Use GEN_OWL_REV_SHARE_STANDARD_POOL_FRACTION */
export const GEN1_REV_SHARE_STANDARD_POOL_FRACTION = GEN_OWL_REV_SHARE_STANDARD_POOL_FRACTION
/** @deprecated Use GEN_OWL_REV_SHARE_ONE_OF_ONE_POOL_FRACTION */
export const GEN1_REV_SHARE_ONE_OF_ONE_POOL_FRACTION = GEN_OWL_REV_SHARE_ONE_OF_ONE_POOL_FRACTION

export function genOwlRevShareDistributionHeadline(group: GenOwlStakingGroupKey): string {
  if (group === 'gen1-owl' || group === 'gen2-owl') {
    return '90% all staked · 10% 1/1 bonus · claim anytime after open'
  }
  return 'Even split · claim anytime after open'
}

/** Short blurb for estimate / claim panels (mobile-first). */
export const GEN_OWL_REV_SHARE_SHORT_BLURB =
  'Pool estimates update during the month. Claims open on the last day (UTC) — leave unclaimed months stacked and grab them whenever you are ready.'

export function genOwlRevShareDistributionSummary(group: GenOwlStakingGroupKey): string {
  if (group === 'gen1-owl') {
    return 'Gen 1: 90% across all nests · 10% 1/1 bonus (1/1s get both).'
  }
  if (group === 'gen2-owl') {
    return 'Gen 2: 90% across all nests · 10% 1/1 bonus (1/1s get both).'
  }
  return 'Amounts split evenly across eligible nests.'
}

export function genOwlRevShareDistributionDetail(group: GenOwlStakingGroupKey): string {
  if (group === 'gen1-owl') {
    return 'Gen 1 pool: 90% split evenly across all staked Gen 1 owls; 10% bonus split evenly across staked Gen 1 1/1s (each 1/1 receives both shares). Claims open on the last day of the month (UTC) and stack until you claim.'
  }
  if (group === 'gen2-owl') {
    return 'Gen 2 pool: 90% split evenly across all staked Gen 2 owls; 10% bonus split evenly across staked Gen 2 1/1s (each 1/1 receives both shares). Claims open on the last day of the month (UTC) and stack until you claim.'
  }
  return 'Split evenly across eligible nests at month-end. Claims open on the last day of the month (UTC) and stack until you claim.'
}

export function genOwlRevShareAdminDistributionNote(group: GenOwlStakingGroupKey): string {
  if (group === 'gen1-owl') {
    return 'Total SOL/USDC for Gen 1 owl stakers — 90% divided evenly across all staked Gen 1 owls (including 1/1s); 10% bonus divided evenly across staked Gen 1 1/1s (90d and 180d tiers combined).'
  }
  if (group === 'gen2-owl') {
    return 'Total SOL/USDC for Gen 2 owl stakers — 90% divided evenly across all staked Gen 2 owls (including 1/1s); 10% bonus divided evenly across staked Gen 2 1/1s.'
  }
  return 'Separate pool for owl stakers.'
}

export function genOwlRevShareGroupLabel(
  group: GenOwlStakingGroupKey,
  bucket: 'standard' | 'one_of_one' | null | undefined
): string {
  if (group === 'gen1-owl') {
    return bucket === 'one_of_one' ? 'Gen 1 1/1' : 'Gen 1'
  }
  if (group === 'gen2-owl') {
    return bucket === 'one_of_one' ? 'Gen 2 1/1' : 'Gen 2'
  }
  return 'Gen'
}

export function genOwlRevShareShortLabel(group: GenOwlStakingGroupKey): string {
  return group === 'gen1-owl' ? 'Gen 1' : group === 'gen2-owl' ? 'Gen 2' : 'Gen'
}
