import type { GenOwlStakingGroupKey } from '@/lib/nesting/gen-owl-staking-groups'

/** Share of the Gen 1 nest pool allocated to all staked Gen 1 owls (non-1/1). */
export const GEN1_REV_SHARE_STANDARD_POOL_FRACTION = 0.9

/** Share of the Gen 1 nest pool allocated to staked Gen 1 1/1 owls. */
export const GEN1_REV_SHARE_ONE_OF_ONE_POOL_FRACTION = 0.1

export function genOwlRevShareDistributionHeadline(group: GenOwlStakingGroupKey): string {
  if (group === 'gen1-owl') {
    return '90% all staked · 10% 1/1 staked · claim after month ends'
  }
  return 'Even split · claim after month ends'
}

export function genOwlRevShareDistributionSummary(group: GenOwlStakingGroupKey): string {
  if (group === 'gen1-owl') {
    return 'Gen 1 is not split evenly across every nest: 90% of the pool is divided evenly across all staked Gen 1 owls; 10% is divided evenly across staked Gen 1 1/1s.'
  }
  return 'Amounts split evenly across eligible nests that were nested at month-end.'
}

export function genOwlRevShareDistributionDetail(group: GenOwlStakingGroupKey): string {
  if (group === 'gen1-owl') {
    return 'Gen 1 pool: 90% split evenly across all staked Gen 1 owls; 10% split evenly across staked Gen 1 1/1s. Claim opens on the 1st of the next month (UTC) in Monthly rev share above.'
  }
  return 'Split evenly across eligible nests at month-end. Claim opens on the 1st of the next month (UTC) in Monthly rev share above.'
}

export function genOwlRevShareAdminDistributionNote(group: GenOwlStakingGroupKey): string {
  if (group === 'gen1-owl') {
    return 'Total SOL/USDC for Gen 1 owl stakers — 90% divided evenly across all staked Gen 1 owls; 10% divided evenly across staked Gen 1 1/1s (90d and 180d tiers combined).'
  }
  return 'Separate pool for Gen 2 owl stakers — even split across active Gen 2 nests.'
}
