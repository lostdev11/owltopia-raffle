import { getSupabaseAdmin } from '@/lib/supabase-admin'

export type AdminReferralPerformanceFilters = {
  from?: string
  to?: string
  raffleId?: string
  creatorWallet?: string
  referralCode?: string
  rewardMode?: string
}

export type AdminReferralPerformancePayload = {
  summary: {
    referralVisits: number
    referralTicketPurchases: number
    freeEntriesIssued: number
    freeEntriesConfirmed: number
    referredRevenue: number
    visitToPurchaseRate: number | null
    visitToFreeEntryRate: number | null
  }
  topCodes: Array<{ code: string; tickets: number; revenue: number }>
  topReferrers: Array<{ code: string; tickets: number; revenue: number }>
  topRaffles: Array<{ raffleId: string; slug: string; title: string; visits: number; purchases: number }>
  freeEntryRedemptions: Array<{
    id: string
    role: string
    code: string
    status: string
    issuedAt: string
    confirmedAt: string | null
    referredWallet: string | null
  }>
}

function inRange(iso: string, from?: string, to?: string): boolean {
  const t = new Date(iso).getTime()
  if (from) {
    const f = new Date(from).getTime()
    if (Number.isFinite(f) && t < f) return false
  }
  if (to) {
    const end = new Date(to).getTime()
    if (Number.isFinite(end) && t > end) return false
  }
  return true
}

export async function getAdminReferralPerformance(
  filters: AdminReferralPerformanceFilters
): Promise<AdminReferralPerformancePayload> {
  const db = getSupabaseAdmin()

  const [viewsRes, entriesRes, rewardsRes, rafflesRes] = await Promise.all([
    db
      .from('raffle_views')
      .select('id, raffle_id, referral_code_used, created_at')
      .not('referral_code_used', 'is', null)
      .limit(50000),
    db
      .from('entries')
      .select(
        'id, raffle_id, referrer_wallet, referral_code_used, ticket_quantity, amount_paid, status, refunded_at, created_at'
      )
      .not('referrer_wallet', 'is', null)
      .eq('status', 'confirmed')
      .limit(80000),
    db.from('referral_rewards').select('*').limit(20000),
    db.from('raffles').select('id, slug, title, created_by, creator_wallet').limit(5000),
  ])

  const views = (viewsRes.data ?? []).filter((v) =>
    inRange(String(v.created_at), filters.from, filters.to)
  )
  const entries = (entriesRes.data ?? []).filter(
    (e) => !e.refunded_at && inRange(String(e.created_at), filters.from, filters.to)
  )
  const rewards = (rewardsRes.data ?? []).filter((r) =>
    inRange(String(r.issued_at), filters.from, filters.to)
  )
  const raffles = rafflesRes.data ?? []

  const raffleById = new Map(raffles.map((r) => [r.id, r]))

  let filteredViews = views
  let filteredEntries = entries
  let filteredRewards = rewards

  if (filters.raffleId) {
    filteredViews = filteredViews.filter((v) => v.raffle_id === filters.raffleId)
    filteredEntries = filteredEntries.filter((e) => e.raffle_id === filters.raffleId)
    filteredRewards = filteredRewards.filter((r) => r.raffle_id === filters.raffleId)
  }

  if (filters.creatorWallet) {
    const cw = filters.creatorWallet.trim()
    const creatorRaffleIds = new Set(
      raffles
        .filter((r) => r.created_by === cw || r.creator_wallet === cw)
        .map((r) => r.id)
    )
    filteredViews = filteredViews.filter((v) => creatorRaffleIds.has(v.raffle_id))
    filteredEntries = filteredEntries.filter((e) => creatorRaffleIds.has(e.raffle_id))
    filteredRewards = filteredRewards.filter(
      (r) => r.raffle_id && creatorRaffleIds.has(r.raffle_id)
    )
  }

  if (filters.referralCode) {
    const code = filters.referralCode.trim().toLowerCase()
    filteredViews = filteredViews.filter(
      (v) => String(v.referral_code_used).toLowerCase() === code
    )
    filteredEntries = filteredEntries.filter(
      (e) => String(e.referral_code_used).toLowerCase() === code
    )
    filteredRewards = filteredRewards.filter(
      (r) => String(r.referral_code).toLowerCase() === code
    )
  }

  if (filters.rewardMode) {
    filteredRewards = filteredRewards.filter((r) => r.reward_mode === filters.rewardMode)
  }

  const referralVisits = filteredViews.length
  const referralTicketPurchases = filteredEntries.length
  let referredRevenue = 0
  for (const e of filteredEntries) {
    referredRevenue += Number(e.amount_paid) || 0
  }

  const freeRewards = filteredRewards.filter((r) => r.reward_mode === 'free_entry')
  const freeEntriesIssued = freeRewards.length
  const freeEntriesConfirmed = freeRewards.filter((r) => r.reward_status === 'confirmed').length

  const codeAgg = new Map<string, { tickets: number; revenue: number }>()
  for (const e of filteredEntries) {
    const code = String(e.referral_code_used || '').toLowerCase()
    if (!code) continue
    const row = codeAgg.get(code) ?? { tickets: 0, revenue: 0 }
    row.tickets += Number(e.ticket_quantity) || 0
    row.revenue += Number(e.amount_paid) || 0
    codeAgg.set(code, row)
  }

  const topCodes = [...codeAgg.entries()]
    .map(([code, v]) => ({ code, ...v }))
    .sort((a, b) => b.tickets - a.tickets)
    .slice(0, 20)

  const topReferrers = topCodes

  const raffleAgg = new Map<string, { visits: number; purchases: number }>()
  for (const v of filteredViews) {
    const id = v.raffle_id as string
    const row = raffleAgg.get(id) ?? { visits: 0, purchases: 0 }
    row.visits += 1
    raffleAgg.set(id, row)
  }
  for (const e of filteredEntries) {
    const id = e.raffle_id as string
    const row = raffleAgg.get(id) ?? { visits: 0, purchases: 0 }
    row.purchases += 1
    raffleAgg.set(id, row)
  }

  const topRaffles = [...raffleAgg.entries()]
    .map(([raffleId, v]) => {
      const r = raffleById.get(raffleId)
      return {
        raffleId,
        slug: r?.slug ?? '',
        title: r?.title ?? 'Raffle',
        visits: v.visits,
        purchases: v.purchases,
      }
    })
    .sort((a, b) => b.visits - a.visits)
    .slice(0, 20)

  const freeEntryRedemptions = freeRewards
    .sort((a, b) => new Date(b.issued_at).getTime() - new Date(a.issued_at).getTime())
    .slice(0, 100)
    .map((r) => ({
      id: r.id as string,
      role: r.reward_recipient_role as string,
      code: r.referral_code as string,
      status: r.reward_status as string,
      issuedAt: r.issued_at as string,
      confirmedAt: (r.confirmed_at as string | null) ?? null,
      referredWallet: (r.referred_wallet as string | null) ?? null,
    }))

  return {
    summary: {
      referralVisits,
      referralTicketPurchases,
      freeEntriesIssued,
      freeEntriesConfirmed,
      referredRevenue,
      visitToPurchaseRate:
        referralVisits > 0 ? referralTicketPurchases / referralVisits : null,
      visitToFreeEntryRate:
        referralVisits > 0 ? freeEntriesConfirmed / referralVisits : null,
    },
    topCodes,
    topReferrers,
    topRaffles,
    freeEntryRedemptions,
  }
}
