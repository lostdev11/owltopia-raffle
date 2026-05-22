/**
 * Admin-only: NFT communities with recent raffle momentum (entries, live raffles, completions).
 */
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export type HotCommunityTrend = 'rising' | 'steady' | 'cooling'

export type HotCommunitySampleRaffle = {
  id: string
  title: string
  slug: string
  status: string
  ticketsSold: number
  uniqueBuyers: number
}

export type HotCommunityRow = {
  brand: string
  /** Heuristic 0–100+ for sorting; higher = hotter right now. */
  hotScore: number
  trend: HotCommunityTrend
  liveCount: number
  completedLast30d: number
  failedLast30d: number
  /** Completed / (completed + failed) in last 90 days, or null if no terminal raffles. */
  successRate: number | null
  ticketsLast7d: number
  buyersLast7d: number
  ticketsPrior7d: number
  medianBuyersOnCompleted: number | null
  sampleRaffles: HotCommunitySampleRaffle[]
}

type RaffleRow = {
  id: string
  title: string
  slug: string
  status: string | null
  prize_type: string | null
  created_at: string
  end_time: string
}

type EntryRow = {
  raffle_id: string
  ticket_quantity: number
  status: string
  wallet_address: string
  created_at: string
}

const MS_DAY = 86_400_000

/** Known collection aliases from raffle titles (case-insensitive). */
const BRAND_PATTERNS: Array<{ test: RegExp; brand: string }> = [
  { test: /vibe tribe/i, brand: 'Vibe Tribe' },
  { test: /nest event|owltopia/i, brand: 'Owltopia / NEST' },
  { test: /okay bear/i, brand: 'Okay Bears' },
  { test: /frens factory/i, brand: 'Frens Factory' },
  { test: /pandarianz/i, brand: 'Pandarianz' },
  { test: /solana stray/i, brand: 'Solana Strays' },
  { test: /moonster/i, brand: 'Moonsters' },
  { test: /basc/i, brand: 'BASC' },
  { test: /mosc/i, brand: 'MOSC' },
  { test: /puffster/i, brand: 'Puffsterz' },
  { test: /shonen/i, brand: 'ShonenSol' },
  { test: /midevil/i, brand: 'MidEvil' },
  { test: /rusty rig|rusty #/i, brand: 'Rusty Rigs' },
  { test: /lp doll/i, brand: 'LP Doll' },
  { test: /solnautz/i, brand: 'Solnautz' },
  { test: /mad lad/i, brand: 'Mad Lads' },
  { test: /y00t/i, brand: 'y00ts' },
  { test: /gecko|ggsg/i, brand: 'Gecko / GGS' },
  { test: /gainz/i, brand: 'GAINZ' },
  { test: /stoned ape|gothic stoned/i, brand: 'Stoned Apes' },
  { test: /\bsmb\b|monke gen/i, brand: 'SMB / Monke' },
  { test: /trippy world/i, brand: 'Trippy World' },
  { test: /meego/i, brand: 'Meegos' },
  { test: /haxz/i, brand: 'Haxz' },
]

/**
 * Infer a community label from raffle title when `nft_collection_name` is unset.
 */
export function inferCommunityBrand(title: string): string {
  const trimmed = title.trim()
  if (!trimmed) return 'Unknown'

  for (const { test, brand } of BRAND_PATTERNS) {
    if (test.test(trimmed)) return brand
  }

  const withoutHashId = trimmed.replace(/\s*#\s*\d+.*$/i, '').trim()
  const withoutTrailingNum = withoutHashId.replace(/\s+\d{3,}\s*$/, '').trim()
  const candidate = withoutTrailingNum || withoutHashId || trimmed

  if (candidate.length > 48) return `${candidate.slice(0, 45)}…`
  return candidate
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!
}

function computeTrend(ticketsLast7d: number, ticketsPrior7d: number): HotCommunityTrend {
  if (ticketsLast7d > ticketsPrior7d * 1.25) return 'rising'
  if (ticketsPrior7d > 0 && ticketsLast7d < ticketsPrior7d * 0.75) return 'cooling'
  return 'steady'
}

function computeHotScore(input: {
  liveCount: number
  ticketsLast7d: number
  buyersLast7d: number
  completedLast30d: number
  successRate: number | null
  medianBuyersOnCompleted: number | null
}): number {
  let score = 0
  score += input.liveCount * 40
  score += Math.min(input.ticketsLast7d * 0.5, 80)
  score += Math.min(input.buyersLast7d * 8, 64)
  score += input.completedLast30d * 15
  if (input.successRate != null && input.successRate >= 70) score += 20
  if (input.medianBuyersOnCompleted != null) {
    score += Math.min(input.medianBuyersOnCompleted * 2, 40)
  }
  return Math.round(score)
}

/**
 * Communities ranked by recent ticket velocity, live raffles, and recent completions.
 */
export async function getHotCommunityRows(): Promise<HotCommunityRow[]> {
  const db = getSupabaseAdmin()
  const now = Date.now()
  const t7 = now - 7 * MS_DAY
  const t14 = now - 14 * MS_DAY
  const t30 = now - 30 * MS_DAY
  const t90 = now - 90 * MS_DAY

  const [rafflesRes, entriesRes] = await Promise.all([
    db
      .from('raffles')
      .select('id, title, slug, status, prize_type, created_at, end_time')
      .eq('prize_type', 'nft')
      .limit(5000),
    db
      .from('entries')
      .select('raffle_id, ticket_quantity, status, wallet_address, created_at')
      .limit(80000),
  ])

  const raffles = (rafflesRes.data || []) as RaffleRow[]
  const entries = (entriesRes.data || []) as EntryRow[]

  type RaffleStats = {
    ticketsSold: number
    uniqueBuyers: Set<string>
    ticketsLast7d: number
    buyersLast7d: Set<string>
    ticketsPrior7d: number
  }

  const statsByRaffle = new Map<string, RaffleStats>()

  const bumpRaffle = (raffleId: string) => {
    let s = statsByRaffle.get(raffleId)
    if (!s) {
      s = {
        ticketsSold: 0,
        uniqueBuyers: new Set(),
        ticketsLast7d: 0,
        buyersLast7d: new Set(),
        ticketsPrior7d: 0,
      }
      statsByRaffle.set(raffleId, s)
    }
    return s
  }

  for (const e of entries) {
    if (e.status !== 'confirmed') continue
    const qty = Number(e.ticket_quantity)
    if (!Number.isFinite(qty) || qty <= 0) continue
    const wallet = (e.wallet_address || '').trim()
    const created = new Date(e.created_at).getTime()

    const s = bumpRaffle(e.raffle_id)
    s.ticketsSold += qty
    if (wallet) s.uniqueBuyers.add(wallet)

    if (created >= t7) {
      s.ticketsLast7d += qty
      if (wallet) s.buyersLast7d.add(wallet)
    } else if (created >= t14) {
      s.ticketsPrior7d += qty
    }
  }

  type BrandAcc = {
    liveCount: number
    completedLast30d: number
    failedLast30d: number
    completedLast90d: number
    failedLast90d: number
    ticketsLast7d: number
    buyersLast7d: Set<string>
    ticketsPrior7d: number
    completedBuyerCounts: number[]
    raffles: Array<{ raffle: RaffleRow; stats: RaffleStats }>
  }

  const byBrand = new Map<string, BrandAcc>()

  const bumpBrand = (brand: string) => {
    let b = byBrand.get(brand)
    if (!b) {
      b = {
        liveCount: 0,
        completedLast30d: 0,
        failedLast30d: 0,
        completedLast90d: 0,
        failedLast90d: 0,
        ticketsLast7d: 0,
        buyersLast7d: new Set(),
        ticketsPrior7d: 0,
        completedBuyerCounts: [],
        raffles: [],
      }
      byBrand.set(brand, b)
    }
    return b
  }

  for (const raffle of raffles) {
    const brand = inferCommunityBrand(raffle.title)
    const stats = statsByRaffle.get(raffle.id) ?? {
      ticketsSold: 0,
      uniqueBuyers: new Set<string>(),
      ticketsLast7d: 0,
      buyersLast7d: new Set(),
      ticketsPrior7d: 0,
    }
    const acc = bumpBrand(brand)
    acc.raffles.push({ raffle, stats })

    const st = (raffle.status || '').toLowerCase()
    const created = new Date(raffle.created_at).getTime()
    const end = new Date(raffle.end_time).getTime()

    if (st === 'live' || st === 'ready_to_draw') {
      if (end > now) acc.liveCount += 1
    }

    if (created >= t30) {
      if (st === 'completed') acc.completedLast30d += 1
      if (st === 'failed_refund_available') acc.failedLast30d += 1
    }

    if (created >= t90) {
      if (st === 'completed') {
        acc.completedLast90d += 1
        if (stats.uniqueBuyers.size > 0) acc.completedBuyerCounts.push(stats.uniqueBuyers.size)
      }
      if (st === 'failed_refund_available') acc.failedLast90d += 1
    }

    acc.ticketsLast7d += stats.ticketsLast7d
    acc.ticketsPrior7d += stats.ticketsPrior7d
    for (const w of stats.buyersLast7d) acc.buyersLast7d.add(w)
  }

  const rows: HotCommunityRow[] = []

  for (const [brand, acc] of byBrand.entries()) {
    const terminal90 = acc.completedLast90d + acc.failedLast90d
    const successRate =
      terminal90 > 0 ? Math.round((100 * acc.completedLast90d) / terminal90) : null

    const medianBuyersOnCompleted = median(acc.completedBuyerCounts)

    const hotScore = computeHotScore({
      liveCount: acc.liveCount,
      ticketsLast7d: acc.ticketsLast7d,
      buyersLast7d: acc.buyersLast7d.size,
      completedLast30d: acc.completedLast30d,
      successRate,
      medianBuyersOnCompleted,
    })

    const hasRecentActivity =
      acc.liveCount > 0 ||
      acc.ticketsLast7d >= 10 ||
      acc.completedLast30d > 0 ||
      acc.failedLast30d > 0

    if (!hasRecentActivity || hotScore < 8) continue

    const sampleRaffles = acc.raffles
      .filter(
        ({ raffle, stats }) =>
          stats.ticketsSold > 0 ||
          ['live', 'ready_to_draw'].includes((raffle.status || '').toLowerCase())
      )
      .sort((a, b) => {
        const aLive = ['live', 'ready_to_draw'].includes((a.raffle.status || '').toLowerCase()) ? 1 : 0
        const bLive = ['live', 'ready_to_draw'].includes((b.raffle.status || '').toLowerCase()) ? 1 : 0
        if (aLive !== bLive) return bLive - aLive
        return b.stats.ticketsLast7d - a.stats.ticketsLast7d || b.stats.ticketsSold - a.stats.ticketsSold
      })
      .slice(0, 3)
      .map(({ raffle, stats }) => ({
        id: raffle.id,
        title: raffle.title,
        slug: raffle.slug,
        status: raffle.status || 'unknown',
        ticketsSold: stats.ticketsSold,
        uniqueBuyers: stats.uniqueBuyers.size,
      }))

    rows.push({
      brand,
      hotScore,
      trend: computeTrend(acc.ticketsLast7d, acc.ticketsPrior7d),
      liveCount: acc.liveCount,
      completedLast30d: acc.completedLast30d,
      failedLast30d: acc.failedLast30d,
      successRate,
      ticketsLast7d: acc.ticketsLast7d,
      buyersLast7d: acc.buyersLast7d.size,
      ticketsPrior7d: acc.ticketsPrior7d,
      medianBuyersOnCompleted,
      sampleRaffles,
    })
  }

  rows.sort((a, b) => b.hotScore - a.hotScore || b.ticketsLast7d - a.ticketsLast7d)
  return rows.slice(0, 20)
}
