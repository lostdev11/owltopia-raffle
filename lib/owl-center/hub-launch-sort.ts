import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'

/** Hub listing bucket — live primary mints surface before ended / secondary-only states. */
export type OwlCenterHubLaunchBucket = 'live' | 'sold_out' | 'trading'

export function getOwlCenterHubLaunchBucket(launch: OwlCenterLaunchPublic): OwlCenterHubLaunchBucket {
  if (launch.active_phase === 'TRADING_ACTIVE') return 'trading'
  if (launch.active_phase === 'SOLD_OUT' || launch.status === 'SOLD_OUT') return 'sold_out'
  return 'live'
}

/** Prefer scheduled go-live, then record creation, then last update. */
export function getOwlCenterLaunchRecencyMs(launch: OwlCenterLaunchPublic): number {
  const times: number[] = []
  const push = (raw: string | null | undefined) => {
    if (!raw?.trim()) return
    const ms = Date.parse(raw)
    if (Number.isFinite(ms)) times.push(ms)
  }

  push(launch.creator_launch_date)
  for (const iso of Object.values(launch.phase_schedule ?? {})) {
    push(iso)
  }
  push(launch.created_at)
  push(launch.updated_at)

  return times.length ? Math.max(...times) : 0
}

const BUCKET_RANK: Record<OwlCenterHubLaunchBucket, number> = {
  live: 0,
  trading: 1,
  sold_out: 2,
}

export function compareOwlCenterHubLaunches(a: OwlCenterLaunchPublic, b: OwlCenterLaunchPublic): number {
  const bucketDelta = BUCKET_RANK[getOwlCenterHubLaunchBucket(a)] - BUCKET_RANK[getOwlCenterHubLaunchBucket(b)]
  if (bucketDelta !== 0) return bucketDelta

  const recencyDelta = getOwlCenterLaunchRecencyMs(b) - getOwlCenterLaunchRecencyMs(a)
  if (recencyDelta !== 0) return recencyDelta

  return a.slug.localeCompare(b.slug)
}

export function sortOwlCenterHubLaunches(launches: OwlCenterLaunchPublic[]): OwlCenterLaunchPublic[] {
  return [...launches].sort(compareOwlCenterHubLaunches)
}

export function partitionOwlCenterHubLaunches(launches: OwlCenterLaunchPublic[]): {
  live: OwlCenterLaunchPublic[]
  soldOut: OwlCenterLaunchPublic[]
  trading: OwlCenterLaunchPublic[]
} {
  const sorted = sortOwlCenterHubLaunches(launches)
  return {
    live: sorted.filter((l) => getOwlCenterHubLaunchBucket(l) === 'live'),
    soldOut: sorted.filter((l) => getOwlCenterHubLaunchBucket(l) === 'sold_out'),
    trading: sorted.filter((l) => getOwlCenterHubLaunchBucket(l) === 'trading'),
  }
}
