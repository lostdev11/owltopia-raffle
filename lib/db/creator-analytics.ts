import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getDisplayNamesByWallets } from '@/lib/db/wallet-profiles'
import { defaultDisplayNameFromWallet } from '@/lib/db/wallet-profiles'

export type CreatorRaffleAnalyticsRow = {
  raffleId: string
  slug: string
  title: string
  imageUrl: string | null
  status: string | null
  endTime: string
  currency: string
  maxTickets: number | null
  views: number
  confirmedTickets: number
  uniqueBuyers: number
  grossRevenue: number
  grossRevenueByCurrency: Record<string, number>
  referralTickets: number
  referralRevenue: number
  referralRevenueByCurrency: Record<string, number>
  conversionRate: number | null
  sellThroughRate: number | null
}

export type CreatorAnalyticsDailyPoint = {
  date: string
  views: number
  tickets: number
  uniqueBuyers: number
  revenue: number
}

export type CreatorTopReferrer = {
  wallet: string
  displayName: string
  referralCode: string
  tickets: number
  revenueByCurrency: Record<string, number>
}

export type CreatorAnalyticsGrowth = {
  views: number | null
  tickets: number | null
  uniqueBuyers: number | null
  grossRevenue: number | null
  referralTickets: number | null
  referralRevenue: number | null
}

export type CreatorAnalyticsPayload = {
  period: {
    days: number | null
    from: string | null
    to: string
  }
  totals: {
    rafflesCreated: number
    confirmedTickets: number
    grossRevenue: number
    grossRevenueByCurrency: Record<string, number>
    uniqueBuyers: number
    referralTickets: number
    referralRevenue: number
    referralRevenueByCurrency: Record<string, number>
    averageSellThroughRate: number | null
    views: number
  }
  growth: CreatorAnalyticsGrowth
  funnel: {
    raffleViews: number
    referralVisits: number
    ticketsPurchased: number
    uniqueBuyers: number
  }
  referralInsights: {
    referralConversionRate: number | null
    referralVisits: number
    freeEntriesEarned: number
    owlRewardsEarned: number
  }
  dailySeries: CreatorAnalyticsDailyPoint[]
  topReferrers: CreatorTopReferrer[]
  raffles: CreatorRaffleAnalyticsRow[]
  updatedAt: string
}

export type CreatorAnalyticsFilters = {
  /** 7, 30, 90, or null for all-time */
  days?: number | null
}

type EntryRow = {
  raffle_id: string
  wallet_address: string
  ticket_quantity: number
  amount_paid: number
  currency: string
  status: string
  referrer_wallet: string | null
  referral_code_used: string | null
  refunded_at: string | null
  created_at: string
}

type ViewRow = {
  raffle_id: string
  created_at: string
  referral_code_used: string | null
  viewer_wallet: string | null
  session_id: string | null
}

type RewardRow = {
  raffle_id: string | null
  reward_mode: string
  reward_status: string
  owl_reward_amount: number | null
  issued_at: string
}

function dateKey(iso: string): string {
  return iso.slice(0, 10)
}

function inRange(iso: string, from: Date | null, to: Date): boolean {
  const t = new Date(iso).getTime()
  if (from && t < from.getTime()) return false
  if (t > to.getTime()) return false
  return true
}

function growthPct(current: number, previous: number): number | null {
  if (previous <= 0) return current > 0 ? 100 : null
  return ((current - previous) / previous) * 100
}

function addToCurrency(map: Record<string, number>, currency: string, amount: number) {
  if (!Number.isFinite(amount) || amount <= 0) return
  const cur = (currency || 'SOL').toUpperCase()
  map[cur] = (map[cur] ?? 0) + amount
}

function sumCurrency(map: Record<string, number>): number {
  return Object.values(map).reduce((a, b) => a + b, 0)
}

function emptyPayload(): CreatorAnalyticsPayload {
  return {
    period: { days: 30, from: null, to: new Date().toISOString() },
    totals: {
      rafflesCreated: 0,
      confirmedTickets: 0,
      grossRevenue: 0,
      grossRevenueByCurrency: {},
      uniqueBuyers: 0,
      referralTickets: 0,
      referralRevenue: 0,
      referralRevenueByCurrency: {},
      averageSellThroughRate: null,
      views: 0,
    },
    growth: {
      views: null,
      tickets: null,
      uniqueBuyers: null,
      grossRevenue: null,
      referralTickets: null,
      referralRevenue: null,
    },
    funnel: { raffleViews: 0, referralVisits: 0, ticketsPurchased: 0, uniqueBuyers: 0 },
    referralInsights: {
      referralConversionRate: null,
      referralVisits: 0,
      freeEntriesEarned: 0,
      owlRewardsEarned: 0,
    },
    dailySeries: [],
    topReferrers: [],
    raffles: [],
    updatedAt: new Date().toISOString(),
  }
}

function computePeriodTotals(params: {
  views: ViewRow[]
  entries: EntryRow[]
  from: Date | null
  to: Date
}) {
  const filteredViews = params.views.filter((v) => inRange(v.created_at, params.from, params.to))
  const filteredEntries = params.entries.filter(
    (e) => !e.refunded_at && inRange(e.created_at, params.from, params.to)
  )

  let views = 0
  let referralVisits = 0
  for (const v of filteredViews) {
    views += 1
    if (v.referral_code_used?.trim()) referralVisits += 1
  }

  let tickets = 0
  let referralTickets = 0
  const grossByCur: Record<string, number> = {}
  const refByCur: Record<string, number> = {}
  const buyers = new Set<string>()
  const refBuyers = new Set<string>()

  for (const e of filteredEntries) {
    const qty = Number(e.ticket_quantity) || 0
    const amt = Number(e.amount_paid) || 0
    tickets += qty
    buyers.add(e.wallet_address)
    addToCurrency(grossByCur, e.currency, amt)
    if (e.referrer_wallet?.trim()) {
      referralTickets += qty
      addToCurrency(refByCur, e.currency, amt)
      refBuyers.add(e.wallet_address)
    }
  }

  return {
    views,
    referralVisits,
    tickets,
    referralTickets,
    grossByCur,
    refByCur,
    uniqueBuyers: buyers.size,
    referredPurchases: refBuyers.size,
  }
}

function buildDailySeries(params: {
  views: ViewRow[]
  entries: EntryRow[]
  from: Date
  to: Date
}): CreatorAnalyticsDailyPoint[] {
  const byDay = new Map<string, { views: number; tickets: number; buyers: Set<string>; revenue: number }>()

  const ensure = (key: string) => {
    let row = byDay.get(key)
    if (!row) {
      row = { views: 0, tickets: 0, buyers: new Set(), revenue: 0 }
      byDay.set(key, row)
    }
    return row
  }

  for (const v of params.views) {
    if (!inRange(v.created_at, params.from, params.to)) continue
    ensure(dateKey(v.created_at)).views += 1
  }

  for (const e of params.entries) {
    if (e.refunded_at || !inRange(e.created_at, params.from, params.to)) continue
    const row = ensure(dateKey(e.created_at))
    row.tickets += Number(e.ticket_quantity) || 0
    row.buyers.add(e.wallet_address)
    const amt = Number(e.amount_paid) || 0
    if (Number.isFinite(amt)) row.revenue += amt
  }

  const keys = [...byDay.keys()].sort()
  return keys.map((date) => {
    const row = byDay.get(date)!
    return {
      date,
      views: row.views,
      tickets: row.tickets,
      uniqueBuyers: row.buyers.size,
      revenue: row.revenue,
    }
  })
}

export async function getCreatorAnalyticsForWallet(
  wallet: string,
  filters: CreatorAnalyticsFilters = {}
): Promise<CreatorAnalyticsPayload> {
  const w = wallet.trim()
  const empty = emptyPayload()
  if (!w) return empty

  const days = filters.days === undefined ? 30 : filters.days
  const to = new Date()
  const from = days != null && days > 0 ? new Date(to.getTime() - days * 24 * 60 * 60 * 1000) : null
  const prevTo = from ? new Date(from.getTime()) : null
  const prevFrom =
    from && days != null && days > 0 ? new Date(from.getTime() - days * 24 * 60 * 60 * 1000) : null

  const db = getSupabaseAdmin()
  const { data: raffles, error: rErr } = await db
    .from('raffles')
    .select('id, slug, title, status, end_time, currency, max_tickets, image_url')
    .or(`created_by.eq.${w},creator_wallet.eq.${w}`)
    .order('created_at', { ascending: false })

  if (rErr || !raffles?.length) {
    if (rErr) console.error('[creator-analytics] raffles:', rErr.message)
    return { ...empty, period: { days, from: from?.toISOString() ?? null, to: to.toISOString() } }
  }

  const raffleIds = raffles.map((r) => r.id)

  const fetchFrom = prevFrom ?? from
  let entriesQuery = db
    .from('entries')
    .select(
      'raffle_id, wallet_address, ticket_quantity, amount_paid, currency, status, referrer_wallet, referral_code_used, refunded_at, created_at'
    )
    .in('raffle_id', raffleIds)
    .eq('status', 'confirmed')

  let viewsQuery = db
    .from('raffle_views')
    .select('raffle_id, created_at, referral_code_used, viewer_wallet, session_id')
    .in('raffle_id', raffleIds)

  if (fetchFrom) {
    const iso = fetchFrom.toISOString()
    entriesQuery = entriesQuery.gte('created_at', iso)
    viewsQuery = viewsQuery.gte('created_at', iso)
  }

  const rewardsQuery = db
    .from('referral_rewards')
    .select('raffle_id, reward_mode, reward_status, owl_reward_amount, issued_at')
    .in('raffle_id', raffleIds)

  const [entriesRes, viewsRes, rewardsRes] = await Promise.all([
    entriesQuery.limit(100000),
    viewsQuery.limit(100000),
    rewardsQuery.limit(20000),
  ])

  if (entriesRes.error) console.error('[creator-analytics] entries:', entriesRes.error.message)
  if (viewsRes.error) console.error('[creator-analytics] views:', viewsRes.error.message)
  if (rewardsRes.error) console.error('[creator-analytics] rewards:', rewardsRes.error.message)

  const entryList = (entriesRes.data ?? []) as EntryRow[]
  const viewList = (viewsRes.data ?? []) as ViewRow[]
  const rewardList = (rewardsRes.data ?? []) as RewardRow[]

  const current = computePeriodTotals({ views: viewList, entries: entryList, from, to })
  const previous =
    prevFrom && prevTo
      ? computePeriodTotals({ views: viewList, entries: entryList, from: prevFrom, to: prevTo })
      : null

  const periodEntries = entryList.filter(
    (e) => !e.refunded_at && inRange(e.created_at, from, to)
  )
  const periodViews = viewList.filter((v) => inRange(v.created_at, from, to))

  const viewsByRaffle = new Map<string, number>()
  const refVisitsByRaffle = new Map<string, number>()
  for (const v of periodViews) {
    viewsByRaffle.set(v.raffle_id, (viewsByRaffle.get(v.raffle_id) ?? 0) + 1)
    if (v.referral_code_used?.trim()) {
      refVisitsByRaffle.set(v.raffle_id, (refVisitsByRaffle.get(v.raffle_id) ?? 0) + 1)
    }
  }

  const rows: CreatorRaffleAnalyticsRow[] = []
  const sellThroughRates: number[] = []

  for (const r of raffles) {
    const raffleEntries = periodEntries.filter((e) => e.raffle_id === r.id)
    const buyers = new Set<string>()
    let tickets = 0
    const grossByCur: Record<string, number> = {}
    let refTickets = 0
    const refByCur: Record<string, number> = {}

    for (const e of raffleEntries) {
      const qty = Number(e.ticket_quantity) || 0
      const amt = Number(e.amount_paid) || 0
      tickets += qty
      buyers.add(e.wallet_address)
      addToCurrency(grossByCur, e.currency, amt)
      if (e.referrer_wallet?.trim()) {
        refTickets += qty
        addToCurrency(refByCur, e.currency, amt)
      }
    }

    const views = viewsByRaffle.get(r.id) ?? 0
    const maxT = r.max_tickets != null ? Number(r.max_tickets) : null
    const sellThrough =
      maxT != null && Number.isFinite(maxT) && maxT > 0 ? tickets / maxT : null
    if (sellThrough != null) sellThroughRates.push(sellThrough)

    rows.push({
      raffleId: r.id,
      slug: r.slug,
      title: r.title,
      imageUrl: r.image_url ?? null,
      status: r.status,
      endTime: r.end_time,
      currency: r.currency,
      maxTickets: maxT,
      views,
      confirmedTickets: tickets,
      uniqueBuyers: buyers.size,
      grossRevenue: sumCurrency(grossByCur),
      grossRevenueByCurrency: grossByCur,
      referralTickets: refTickets,
      referralRevenue: sumCurrency(refByCur),
      referralRevenueByCurrency: refByCur,
      conversionRate: views > 0 ? buyers.size / views : null,
      sellThroughRate: sellThrough,
    })
  }

  const referrerAgg = new Map<
    string,
    { wallet: string; code: string; tickets: number; revenueByCurrency: Record<string, number> }
  >()
  for (const e of periodEntries) {
    const ref = e.referrer_wallet?.trim()
    if (!ref) continue
    const code = e.referral_code_used?.trim() || ref
    const key = ref.toLowerCase()
    let row = referrerAgg.get(key)
    if (!row) {
      row = { wallet: ref, code, tickets: 0, revenueByCurrency: {} }
      referrerAgg.set(key, row)
    }
    row.tickets += Number(e.ticket_quantity) || 0
    addToCurrency(row.revenueByCurrency, e.currency, Number(e.amount_paid) || 0)
  }

  const topRefWallets = [...referrerAgg.values()]
    .sort((a, b) => b.tickets - a.tickets)
    .slice(0, 5)

  const displayNames =
    topRefWallets.length > 0
      ? await getDisplayNamesByWallets(topRefWallets.map((r) => r.wallet))
      : {}

  const topReferrers: CreatorTopReferrer[] = topRefWallets.map((r) => ({
    wallet: r.wallet,
    displayName: displayNames[r.wallet] ?? defaultDisplayNameFromWallet(r.wallet),
    referralCode: r.code,
    tickets: r.tickets,
    revenueByCurrency: r.revenueByCurrency,
  }))

  const periodRewards = rewardList.filter((r) => inRange(r.issued_at, from, to))
  let freeEntriesEarned = 0
  let owlRewardsEarned = 0
  for (const r of periodRewards) {
    if (r.reward_mode === 'free_entry' && r.reward_status === 'confirmed') freeEntriesEarned += 1
    if (r.reward_mode === 'owl_token' && r.reward_status === 'confirmed') {
      const amt = Number(r.owl_reward_amount)
      if (Number.isFinite(amt)) owlRewardsEarned += amt
    }
  }

  const dailySeries =
    from != null
      ? buildDailySeries({ views: viewList, entries: entryList, from, to })
      : buildDailySeries({
          views: viewList,
          entries: entryList,
          from: new Date(to.getTime() - 29 * 24 * 60 * 60 * 1000),
          to,
        })

  const avgSellThrough =
    sellThroughRates.length > 0
      ? sellThroughRates.reduce((a, b) => a + b, 0) / sellThroughRates.length
      : null

  return {
    period: { days, from: from?.toISOString() ?? null, to: to.toISOString() },
    totals: {
      rafflesCreated: raffles.length,
      confirmedTickets: current.tickets,
      grossRevenue: sumCurrency(current.grossByCur),
      grossRevenueByCurrency: current.grossByCur,
      uniqueBuyers: current.uniqueBuyers,
      referralTickets: current.referralTickets,
      referralRevenue: sumCurrency(current.refByCur),
      referralRevenueByCurrency: current.refByCur,
      averageSellThroughRate: avgSellThrough,
      views: current.views,
    },
    growth: {
      views: previous ? growthPct(current.views, previous.views) : null,
      tickets: previous ? growthPct(current.tickets, previous.tickets) : null,
      uniqueBuyers: previous ? growthPct(current.uniqueBuyers, previous.uniqueBuyers) : null,
      grossRevenue: previous
        ? growthPct(sumCurrency(current.grossByCur), sumCurrency(previous.grossByCur))
        : null,
      referralTickets: previous
        ? growthPct(current.referralTickets, previous.referralTickets)
        : null,
      referralRevenue: previous
        ? growthPct(sumCurrency(current.refByCur), sumCurrency(previous.refByCur))
        : null,
    },
    funnel: {
      raffleViews: current.views,
      referralVisits: current.referralVisits,
      ticketsPurchased: current.tickets,
      uniqueBuyers: current.uniqueBuyers,
    },
    referralInsights: {
      referralConversionRate:
        current.referralVisits > 0 ? current.referredPurchases / current.referralVisits : null,
      referralVisits: current.referralVisits,
      freeEntriesEarned,
      owlRewardsEarned,
    },
    dailySeries,
    topReferrers,
    raffles: rows,
    updatedAt: new Date().toISOString(),
  }
}
