import type { StakingPositionRow } from '@/lib/db/staking-positions'
import type { StakingPoolRow } from '@/lib/db/staking-pools'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import type { GenOwlStakingGroupKey } from '@/lib/nesting/gen-owl-staking-groups'
import {
  GEN1_OWL_STAKING_POOL_SLUGS,
  GEN2_OWL_STAKING_POOL_SLUGS,
} from '@/lib/nesting/gen1-staking-pools'
import { endOfPeriodMonthUtc, groupKeyForPoolSlug } from '@/lib/nesting/gen-owl-rev-share-month'

const GROUP_SLUGS: Record<GenOwlStakingGroupKey, readonly string[]> = {
  'gen1-owl': GEN1_OWL_STAKING_POOL_SLUGS,
  'gen2-owl': GEN2_OWL_STAKING_POOL_SLUGS,
}

export type GenOwlEligibleNest = {
  position: StakingPositionRow
  pool: Pick<StakingPoolRow, 'id' | 'slug' | 'name'>
  group: GenOwlStakingGroupKey
}

/** Nested at month-end: staked before end and still active, or unstaked after month ended. */
export function isPositionEligibleForRevSharePeriod(
  position: StakingPositionRow,
  periodMonth: string
): boolean {
  const end = endOfPeriodMonthUtc(periodMonth)
  if (!end) return false
  const endMs = end.getTime()
  const stakedMs = new Date(position.staked_at).getTime()
  if (!Number.isFinite(stakedMs) || stakedMs > endMs) return false

  if (position.status === 'active') return true
  if (position.status === 'unstaked' && position.unstaked_at) {
    const unstakedMs = new Date(position.unstaked_at).getTime()
    return Number.isFinite(unstakedMs) && unstakedMs > endMs
  }
  return false
}

export async function listEligibleGenOwlNestsForPeriod(
  periodMonth: string
): Promise<GenOwlEligibleNest[]> {
  const end = endOfPeriodMonthUtc(periodMonth)
  if (!end) return []

  const db = getSupabaseAdmin()
  const slugs = [...GEN1_OWL_STAKING_POOL_SLUGS, ...GEN2_OWL_STAKING_POOL_SLUGS]
  const { data: pools, error: poolError } = await db.from('staking_pools').select('id, slug, name').in('slug', slugs)
  if (poolError || !pools?.length) return []

  const poolById = new Map(pools.map((p) => [p.id, p]))
  const poolIds = pools.map((p) => p.id)

  const { data: positions, error: posError } = await db
    .from('staking_positions')
    .select('*')
    .in('pool_id', poolIds)
    .in('status', ['active', 'unstaked'])

  if (posError || !positions?.length) return []

  const out: GenOwlEligibleNest[] = []
  for (const row of positions as StakingPositionRow[]) {
    if (!isPositionEligibleForRevSharePeriod(row, periodMonth)) continue
    const pool = poolById.get(row.pool_id)
    if (!pool) continue
    const group = groupKeyForPoolSlug(pool.slug)
    if (!group) continue
    out.push({ position: row, pool, group })
  }
  return out
}

export function countEligibleByGroup(nests: GenOwlEligibleNest[]): Record<GenOwlStakingGroupKey, number> {
  let gen1 = 0
  let gen2 = 0
  for (const n of nests) {
    if (n.group === 'gen1-owl') gen1++
    else gen2++
  }
  return { 'gen1-owl': gen1, 'gen2-owl': gen2 }
}

export function poolSlugsForGroup(group: GenOwlStakingGroupKey): readonly string[] {
  return GROUP_SLUGS[group]
}
