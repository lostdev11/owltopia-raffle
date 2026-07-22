import { getSupabaseAdmin } from '@/lib/supabase-admin'
import {
  NEST_ROSTER_GROUP_SLUGS,
  type NestRosterGroupKey,
} from '@/lib/nesting/nest-roster-groups'

const POSITIONS_PAGE_SIZE = 1000
const WALLET_CHUNK_SIZE = 200

export type GenOwlNestRosterTier = {
  pool_slug: string
  lock_period_days: number
  nest_count: number
  wallet_count: number
}

export type GenOwlNestRosterWallet = {
  wallet_address: string
  /** Open nest count per lock tier, keyed by pool slug (e.g. gen1-owl-90d). */
  nests_by_tier: Record<string, number>
  total_nests: number
  first_staked_at: string | null
  next_unlock_at: string | null
  /** The nester's own referral code (wallet_referrals.active_code), if they have one. */
  referral_code: string | null
  /** Confirmed raffle ticket purchases attributed to this wallet's referral code. */
  referred_purchases: number
}

export type GenOwlNestRosterPosition = {
  position_id: string
  wallet_address: string
  pool_slug: string
  lock_period_days: number
  asset_identifier: string | null
  status: string
  staked_at: string
  unlock_at: string | null
  referral_code: string | null
}

export type GenOwlNestRosterPayload = {
  group: NestRosterGroupKey
  generated_at: string
  tiers: GenOwlNestRosterTier[]
  wallets: GenOwlNestRosterWallet[]
  positions: GenOwlNestRosterPosition[]
}

type PositionRow = {
  id: string
  wallet_address: string
  pool_id: string
  asset_identifier: string | null
  status: string
  staked_at: string
  unlock_at: string | null
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * Who nested — open (active + pending) nests for Owltopia coins or a Gen 1 / Gen 2 owl group,
 * broken down by lock tier, with each nester's referral code.
 */
export async function getGenOwlNestRoster(group: NestRosterGroupKey): Promise<GenOwlNestRosterPayload> {
  const db = getSupabaseAdmin()
  const generatedAt = new Date().toISOString()

  const { data: pools, error: poolError } = await db
    .from('staking_pools')
    .select('id, slug, lock_period_days')
    .in('slug', [...NEST_ROSTER_GROUP_SLUGS[group]])
  if (poolError) throw new Error(poolError.message)

  const poolById = new Map<string, { slug: string; lock_period_days: number }>()
  for (const p of pools ?? []) {
    poolById.set(String(p.id), {
      slug: String(p.slug),
      lock_period_days: Number(p.lock_period_days) || 0,
    })
  }
  const poolIds = [...poolById.keys()]
  if (poolIds.length === 0) {
    return { group, generated_at: generatedAt, tiers: [], wallets: [], positions: [] }
  }

  const rows: PositionRow[] = []
  for (let offset = 0; ; offset += POSITIONS_PAGE_SIZE) {
    const { data, error } = await db
      .from('staking_positions')
      .select('id, wallet_address, pool_id, asset_identifier, status, staked_at, unlock_at')
      .in('pool_id', poolIds)
      .in('status', ['active', 'pending'])
      .order('staked_at', { ascending: true })
      .range(offset, offset + POSITIONS_PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    const page = (data ?? []) as PositionRow[]
    rows.push(...page)
    if (page.length < POSITIONS_PAGE_SIZE) break
  }

  const wallets = [...new Set(rows.map((r) => r.wallet_address.trim()).filter(Boolean))]

  const codeByWallet = new Map<string, string>()
  for (const walletChunk of chunk(wallets, WALLET_CHUNK_SIZE)) {
    const { data, error } = await db
      .from('wallet_referrals')
      .select('wallet_address, active_code')
      .in('wallet_address', walletChunk)
    if (error) {
      console.error('[gen-owl-nest-roster] wallet_referrals lookup:', error.message)
      break
    }
    for (const row of data ?? []) {
      const w = String(row.wallet_address ?? '').trim()
      const code = String(row.active_code ?? '').trim()
      if (w && code) codeByWallet.set(w, code)
    }
  }

  // Confirmed ticket purchases attributed to each nester's referral code (referral program tie-in).
  const referredPurchasesByWallet = new Map<string, number>()
  for (const walletChunk of chunk(wallets, WALLET_CHUNK_SIZE)) {
    const { data, error } = await db
      .from('entries')
      .select('referrer_wallet')
      .in('referrer_wallet', walletChunk)
      .eq('status', 'confirmed')
      .is('refunded_at', null)
      .limit(50000)
    if (error) {
      console.error('[gen-owl-nest-roster] referred entries lookup:', error.message)
      break
    }
    for (const row of data ?? []) {
      const w = String(row.referrer_wallet ?? '').trim()
      if (!w) continue
      referredPurchasesByWallet.set(w, (referredPurchasesByWallet.get(w) ?? 0) + 1)
    }
  }

  const positions: GenOwlNestRosterPosition[] = rows.map((r) => {
    const pool = poolById.get(r.pool_id)
    const wallet = r.wallet_address.trim()
    return {
      position_id: r.id,
      wallet_address: wallet,
      pool_slug: pool?.slug ?? 'unknown',
      lock_period_days: pool?.lock_period_days ?? 0,
      asset_identifier: r.asset_identifier,
      status: r.status,
      staked_at: r.staked_at,
      unlock_at: r.unlock_at,
      referral_code: codeByWallet.get(wallet) ?? null,
    }
  })

  const walletAgg = new Map<string, GenOwlNestRosterWallet>()
  for (const pos of positions) {
    let agg = walletAgg.get(pos.wallet_address)
    if (!agg) {
      agg = {
        wallet_address: pos.wallet_address,
        nests_by_tier: {},
        total_nests: 0,
        first_staked_at: null,
        next_unlock_at: null,
        referral_code: codeByWallet.get(pos.wallet_address) ?? null,
        referred_purchases: referredPurchasesByWallet.get(pos.wallet_address) ?? 0,
      }
      walletAgg.set(pos.wallet_address, agg)
    }
    agg.nests_by_tier[pos.pool_slug] = (agg.nests_by_tier[pos.pool_slug] ?? 0) + 1
    agg.total_nests += 1
    if (!agg.first_staked_at || pos.staked_at < agg.first_staked_at) {
      agg.first_staked_at = pos.staked_at
    }
    if (pos.unlock_at && (!agg.next_unlock_at || pos.unlock_at < agg.next_unlock_at)) {
      agg.next_unlock_at = pos.unlock_at
    }
  }

  const tierWallets = new Map<string, Set<string>>()
  const tierNests = new Map<string, number>()
  for (const pos of positions) {
    tierNests.set(pos.pool_slug, (tierNests.get(pos.pool_slug) ?? 0) + 1)
    let set = tierWallets.get(pos.pool_slug)
    if (!set) {
      set = new Set()
      tierWallets.set(pos.pool_slug, set)
    }
    set.add(pos.wallet_address)
  }

  const tiers: GenOwlNestRosterTier[] = [...poolById.values()]
    .sort((a, b) => a.lock_period_days - b.lock_period_days)
    .map((pool) => ({
      pool_slug: pool.slug,
      lock_period_days: pool.lock_period_days,
      nest_count: tierNests.get(pool.slug) ?? 0,
      wallet_count: tierWallets.get(pool.slug)?.size ?? 0,
    }))

  const walletList = [...walletAgg.values()].sort((a, b) => b.total_nests - a.total_nests)

  return {
    group,
    generated_at: generatedAt,
    tiers,
    wallets: walletList,
    positions,
  }
}
