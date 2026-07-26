/** Client-safe display helpers for Owl Nesting UI. */

/** Canonical Owltopia coin NFT perch slug (`staking_pools.slug`). */
export const OWL_NEST_365_SLUG = 'owl-nest-365'

export function isNftStakingPool(pool: { asset_type: string }): boolean {
  return pool.asset_type?.toLowerCase() === 'nft'
}

export function isTokenStakingPool(pool: { asset_type: string }): boolean {
  return pool.asset_type?.toLowerCase() === 'token'
}

/** Tokens vs NFTs for perch cards and the nest flow (friendly copy—backend still calls them pools). */
export function perchAssetKindLabel(assetType: string): string {
  if (isTokenStakingPool({ asset_type: assetType })) return 'Tokens'
  if (isNftStakingPool({ asset_type: assetType })) return 'NFTs'
  return assetType
}

export function formatRewardRate(rate: number, unit: string): string {
  const r = Number(rate)
  if (!Number.isFinite(r)) return '—'
  const label =
    unit === 'hourly' ? '/ hr' : unit === 'weekly' ? '/ wk' : '/ day'
  return `${r}${label}`
}

/** Convert a pool rate into OWL (or reward token) per day. */
export function rewardRateToDaily(rate: number, unit: string): number {
  const r = Number(rate)
  if (!Number.isFinite(r) || r < 0) return 0
  if (unit === 'hourly') return r * 24
  if (unit === 'weekly') return r / 7
  return r
}

/** Total reward accrued over a full lock for one nest unit (1 NFT or 1 token unit). */
export function nestLockPeriodTotalReward(
  rate: number,
  unit: string,
  lockPeriodDays: number
): number {
  const days = Number(lockPeriodDays)
  if (!Number.isFinite(days) || days <= 0) return 0
  return rewardRateToDaily(rate, unit) * days
}

function formatOwlAmount(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (Number.isInteger(n)) return String(n)
  if (n >= 10) return n.toFixed(1).replace(/\.0$/, '')
  return n.toFixed(2).replace(/\.?0+$/, '')
}

/** e.g. "0.2 OWL / day" */
export function formatDailyOwlPerNest(rate: number, unit: string, token = 'OWL'): string {
  const daily = rewardRateToDaily(rate, unit)
  if (daily <= 0) return '—'
  return `${formatOwlAmount(daily)} ${token} / day`
}

/** e.g. "~18 OWL over 90 days" — the balance one nest earns if held through unlock. */
export function formatNestLockBalance(
  rate: number,
  unit: string,
  lockPeriodDays: number,
  token = 'OWL'
): string {
  const total = nestLockPeriodTotalReward(rate, unit, lockPeriodDays)
  if (total <= 0) return '—'
  const days = Math.round(Number(lockPeriodDays))
  return `~${formatOwlAmount(total)} ${token} over ${days} days`
}

export function shortenAddress(addr: string, chars = 4): string {
  const a = addr.trim()
  if (a.length <= chars * 2 + 1) return a
  return `${a.slice(0, chars)}…${a.slice(-chars)}`
}

/** Match dashboard `?pool=` by UUID or perch slug (e.g. `owl-nest-365`). */
export function findStakingPoolByIdOrSlug<T extends { id: string; slug: string }>(
  pools: T[],
  key: string | null | undefined
): T | null {
  const k = key?.trim()
  if (!k) return null
  const byId = pools.find((p) => p.id === k)
  if (byId) return byId
  const lower = k.toLowerCase()
  return pools.find((p) => p.slug.toLowerCase() === lower) ?? null
}

/** When only one NFT perch is live, treat it as the Owltopia coin perch (no picker). */
export function soleNftStakingPool<T extends { asset_type: string }>(pools: T[]): T | null {
  const nftPools = pools.filter(isNftStakingPool)
  return nftPools.length === 1 ? nftPools[0]! : null
}

/**
 * Default NFT perch for My nest: canonical owl-nest-365, else the only live NFT perch.
 * Token perches (e.g. council governance) never win this default.
 */
export function defaultOwltopiaCoinPerch<T extends { id: string; slug: string; asset_type: string }>(
  pools: T[]
): T | null {
  const canonical = findStakingPoolByIdOrSlug(pools, OWL_NEST_365_SLUG)
  if (canonical && isNftStakingPool(canonical)) return canonical
  return soleNftStakingPool(pools)
}
