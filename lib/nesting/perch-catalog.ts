import type { StakingPoolRow } from '@/lib/db/staking-pools'
import { getOwlCouncilGovernanceNestingPoolSlug } from '@/lib/council/council-stake-migration'

export function isCouncilGovernanceNestingPool(
  pool: Pick<StakingPoolRow, 'slug'> | string | null | undefined
): boolean {
  const slug = (typeof pool === 'string' ? pool : pool?.slug)?.trim().toLowerCase()
  if (!slug) return false
  return slug === getOwlCouncilGovernanceNestingPoolSlug().toLowerCase()
}

/** OWL Council voting stake — not listed on the public nesting landing / perch picker. */
export function filterPoolsForPublicNestingCatalog(pools: StakingPoolRow[]): StakingPoolRow[] {
  return pools.filter((p) => !isCouncilGovernanceNestingPool(p))
}

export function councilGovernanceNestingDashboardPath(): string {
  return `/dashboard/nesting?pool=${encodeURIComponent(getOwlCouncilGovernanceNestingPoolSlug())}`
}
