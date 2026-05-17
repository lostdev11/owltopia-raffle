import { countOpenStakingPositionsForPool } from '@/lib/db/staking-positions'
import { getStakingPoolBySlug } from '@/lib/db/staking-pools'

/** Canonical Owl Nest NFT perch (365-day lock). */
export const OWL_NEST_365_SLUG = 'owl-nest-365'

/** Owltopia coin collection supply (one nest slot per NFT). */
const DEFAULT_OWL_NEST_GLOBAL_CAPACITY = 1000

function readCapacity(raw: string | undefined): number {
  if (!raw?.trim()) return DEFAULT_OWL_NEST_GLOBAL_CAPACITY
  const n = Number(raw.trim())
  if (!Number.isFinite(n) || n < 1) return DEFAULT_OWL_NEST_GLOBAL_CAPACITY
  return Math.floor(n)
}

/** Global nest slots shown on the public nesting progress bar (all wallets combined). */
export function getOwlNest365GlobalCapacity(): number {
  if (typeof process === 'undefined') return DEFAULT_OWL_NEST_GLOBAL_CAPACITY
  return readCapacity(
    process.env.NESTING_OWL_NEST_GLOBAL_CAPACITY?.trim() ||
      process.env.NEXT_PUBLIC_NESTING_OWL_NEST_GLOBAL_CAPACITY?.trim() ||
      process.env.NESTING_OWL_NEST_365_GLOBAL_CAPACITY?.trim() ||
      process.env.NEXT_PUBLIC_NESTING_OWL_NEST_365_GLOBAL_CAPACITY?.trim()
  )
}

export type OwlNest365PublicStats = {
  pool_slug: string
  pool_name: string
  lock_period_days: number
  staked: number
  capacity: number
  remaining: number
  percent_staked: number
}

export async function getOwlNest365PublicStats(): Promise<OwlNest365PublicStats | null> {
  const pool = await getStakingPoolBySlug(OWL_NEST_365_SLUG)
  if (!pool || pool.asset_type !== 'nft') return null

  const staked = await countOpenStakingPositionsForPool(pool.id)
  const capacity = getOwlNest365GlobalCapacity()
  const remaining = Math.max(0, capacity - staked)
  const percent_staked =
    capacity > 0 ? Math.min(100, Math.round((staked / capacity) * 1000) / 10) : 0

  return {
    pool_slug: pool.slug,
    pool_name: pool.name,
    lock_period_days: pool.lock_period_days,
    staked,
    capacity,
    remaining,
    percent_staked,
  }
}
