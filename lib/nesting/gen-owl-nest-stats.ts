import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { countOpenStakingPositionsForPools } from '@/lib/db/staking-positions'
import {
  type GenOwlStakingGroupKey,
  genOwlStakingGroupLabel,
  resolveGenOwlGroupKey,
} from '@/lib/nesting/gen-owl-staking-groups'
import { GEN1_OWL_STAKING_POOL_SLUGS, GEN2_OWL_STAKING_POOL_SLUGS } from '@/lib/nesting/gen1-staking-pools'

const GROUP_SLUGS: Record<GenOwlStakingGroupKey, readonly string[]> = {
  'gen1-owl': GEN1_OWL_STAKING_POOL_SLUGS,
  'gen2-owl': GEN2_OWL_STAKING_POOL_SLUGS,
}

/** Gen 1 collection size used for the community nest capacity bar (env-overridable). */
const DEFAULT_GEN1_OWL_GLOBAL_CAPACITY = 343
/** Gen 2 collection supply used for the community nest capacity bar (env-overridable). */
const DEFAULT_GEN2_OWL_GLOBAL_CAPACITY = 2000

const DEFAULT_CAPACITY: Record<GenOwlStakingGroupKey, number> = {
  'gen1-owl': DEFAULT_GEN1_OWL_GLOBAL_CAPACITY,
  'gen2-owl': DEFAULT_GEN2_OWL_GLOBAL_CAPACITY,
}

function readCapacity(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) return fallback
  const n = Number(raw.trim())
  if (!Number.isFinite(n) || n < 1) return fallback
  return Math.floor(n)
}

/** Global nest slots shown on the public Gen 1 / Gen 2 nesting progress bars (all wallets combined). */
export function getGenOwlNestGlobalCapacity(group: GenOwlStakingGroupKey): number {
  const fallback = DEFAULT_CAPACITY[group]
  if (typeof process === 'undefined') return fallback

  if (group === 'gen1-owl') {
    return readCapacity(
      process.env.NESTING_GEN1_OWL_GLOBAL_CAPACITY?.trim() ||
        process.env.NEXT_PUBLIC_NESTING_GEN1_OWL_GLOBAL_CAPACITY?.trim(),
      fallback
    )
  }

  return readCapacity(
    process.env.NESTING_GEN2_OWL_GLOBAL_CAPACITY?.trim() ||
      process.env.NEXT_PUBLIC_NESTING_GEN2_OWL_GLOBAL_CAPACITY?.trim(),
    fallback
  )
}

export type GenOwlNestPublicStats = {
  group_key: GenOwlStakingGroupKey
  group_label: string
  staked: number
  capacity: number
  remaining: number
  percent_staked: number
  lock_tiers_days: number[]
}

export function parseGenOwlNestStatsGroup(
  value: string | null | undefined
): GenOwlStakingGroupKey | null {
  return resolveGenOwlGroupKey(value)
}

export async function getGenOwlNestPublicStats(
  group: GenOwlStakingGroupKey
): Promise<GenOwlNestPublicStats | null> {
  const slugs = [...GROUP_SLUGS[group]]
  const db = getSupabaseAdmin()

  const { data: pools, error } = await db
    .from('staking_pools')
    .select('id, lock_period_days, asset_type, is_active')
    .in('slug', slugs)

  if (error) {
    console.error('[gen-owl-nest-stats] pool lookup:', error.message)
    return null
  }

  const nftPools = (pools ?? []).filter(
    (p) => (p as { asset_type?: string }).asset_type === 'nft' && (p as { is_active?: boolean }).is_active !== false
  )
  if (nftPools.length === 0) return null

  const poolIds = nftPools.map((p) => String((p as { id: string }).id)).filter(Boolean)
  const staked = await countOpenStakingPositionsForPools(poolIds)
  const capacity = getGenOwlNestGlobalCapacity(group)
  const remaining = Math.max(0, capacity - staked)
  const percent_staked =
    capacity > 0 ? Math.min(100, Math.round((staked / capacity) * 1000) / 10) : 0

  const lock_tiers_days = [
    ...new Set(
      nftPools
        .map((p) => Number((p as { lock_period_days?: number }).lock_period_days))
        .filter((d) => Number.isFinite(d) && d > 0)
    ),
  ].sort((a, b) => a - b)

  return {
    group_key: group,
    group_label: genOwlStakingGroupLabel(group),
    staked,
    capacity,
    remaining,
    percent_staked,
    lock_tiers_days,
  }
}

export async function getGenOwlNestPublicStatsByGroup(): Promise<
  Partial<Record<GenOwlStakingGroupKey, GenOwlNestPublicStats>>
> {
  const [gen1, gen2] = await Promise.all([
    getGenOwlNestPublicStats('gen1-owl'),
    getGenOwlNestPublicStats('gen2-owl'),
  ])
  const out: Partial<Record<GenOwlStakingGroupKey, GenOwlNestPublicStats>> = {}
  if (gen1) out['gen1-owl'] = gen1
  if (gen2) out['gen2-owl'] = gen2
  return out
}
