import type { StakingPoolRow } from '@/lib/db/staking-pools'
import {
  GEN1_OWL_STAKING_POOL_SLUGS,
  GEN2_OWL_STAKING_POOL_SLUGS,
  isGen1OwlStakingPoolSlug,
  isGen2OwlStakingPoolSlug,
} from '@/lib/nesting/gen1-staking-pools'

/** URL / picker key for a consolidated Gen 1 or Gen 2 perch card. */
export type GenOwlStakingGroupKey = 'gen1-owl' | 'gen2-owl'

const GEN_OWL_GROUP_SLUGS: Record<GenOwlStakingGroupKey, readonly string[]> = {
  'gen1-owl': GEN1_OWL_STAKING_POOL_SLUGS,
  'gen2-owl': GEN2_OWL_STAKING_POOL_SLUGS,
}

export function resolveGenOwlGroupKey(value: string | null | undefined): GenOwlStakingGroupKey | null {
  const v = value?.trim().toLowerCase()
  if (v === 'gen1-owl' || v === 'gen1') return 'gen1-owl'
  if (v === 'gen2-owl' || v === 'gen2') return 'gen2-owl'
  return null
}

export function getGenOwlGroupKeyForPoolSlug(slug: string | null | undefined): GenOwlStakingGroupKey | null {
  if (isGen1OwlStakingPoolSlug(slug)) return 'gen1-owl'
  if (isGen2OwlStakingPoolSlug(slug)) return 'gen2-owl'
  return null
}

export function genOwlStakingGroupLabel(key: GenOwlStakingGroupKey): string {
  return key === 'gen1-owl' ? 'Gen 1 Owl' : 'Gen 2 Owl'
}

export function genOwlStakingGroupDescription(key: GenOwlStakingGroupKey): string {
  return key === 'gen1-owl'
    ? 'Stake an original Owltopia Gen 1 owl. Pick a 90- or 180-day lock when you open a nest.'
    : 'Stake an Owltopia Gen 2 owl. Pick a 90- or 180-day lock when you open a nest.'
}

export function tiersForGenOwlGroup(
  groupKey: GenOwlStakingGroupKey,
  pools: StakingPoolRow[]
): StakingPoolRow[] {
  const slugs = new Set<string>(GEN_OWL_GROUP_SLUGS[groupKey])
  return pools
    .filter((p) => slugs.has(p.slug))
    .sort((a, b) => a.lock_period_days - b.lock_period_days || a.display_order - b.display_order)
}

export type NestingPerchDisplayItem =
  | { kind: 'pool'; pool: StakingPoolRow }
  | { kind: 'gen_owl_group'; groupKey: GenOwlStakingGroupKey; tiers: StakingPoolRow[] }

/**
 * Collapse Gen 1 / Gen 2 90d+180d rows into one landing card each; leave other pools as-is.
 */
export function buildNestingPerchDisplayList(pools: StakingPoolRow[]): NestingPerchDisplayItem[] {
  const gen1Tiers = tiersForGenOwlGroup('gen1-owl', pools)
  const gen2Tiers = tiersForGenOwlGroup('gen2-owl', pools)
  const groupedSlugs = new Set<string>([
    ...gen1Tiers.map((p) => p.slug),
    ...gen2Tiers.map((p) => p.slug),
  ])

  const items: NestingPerchDisplayItem[] = []
  const insertedGroups = new Set<GenOwlStakingGroupKey>()

  for (const pool of pools) {
    const groupKey = getGenOwlGroupKeyForPoolSlug(pool.slug)
    if (groupKey && groupedSlugs.has(pool.slug)) {
      if (insertedGroups.has(groupKey)) continue
      const tiers = groupKey === 'gen1-owl' ? gen1Tiers : gen2Tiers
      if (tiers.length === 0) continue
      insertedGroups.add(groupKey)
      items.push({ kind: 'gen_owl_group', groupKey, tiers })
      continue
    }
    items.push({ kind: 'pool', pool })
  }

  return items
}

export function genOwlGroupDashboardHref(groupKey: GenOwlStakingGroupKey): string {
  return `/dashboard/nesting?group=${encodeURIComponent(groupKey)}`
}

/** Tier pool only when it belongs to the active Gen 1 / Gen 2 group. */
export function resolveGenOwlTierPool<T extends { slug: string }>(
  pools: T[],
  groupKey: GenOwlStakingGroupKey | null,
  tierSlug: string | null | undefined
): T | null {
  if (!groupKey || !tierSlug?.trim()) return null
  const pool = pools.find(
    (p) => p.slug.toLowerCase() === tierSlug.trim().toLowerCase()
  )
  if (!pool) return null
  return getGenOwlGroupKeyForPoolSlug(pool.slug) === groupKey ? pool : null
}
