/**
 * Public leaderboard: top 10 platform users by raffles entered, raffles created, and tickets sold.
 */
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export type LeaderboardEntry = {
  rank: number
  wallet: string
  value: number
}

export type LeaderboardData = {
  rafflesEntered: LeaderboardEntry[]
  rafflesCreated: LeaderboardEntry[]
  ticketsSold: LeaderboardEntry[]
  rafflesWon: LeaderboardEntry[]
}

function normalizeWallet(v: string | null | undefined): string {
  const s = typeof v === 'string' ? v.trim() : ''
  return s || ''
}

function takeTopTen<T>(items: { wallet: string; value: number }[]): LeaderboardEntry[] {
  return items
    .sort((a, b) => b.value - a.value)
    .slice(0, 10)
    .map((item, i) => ({ rank: i + 1, wallet: item.wallet, value: item.value }))
}

/**
 * Returns top 10 users for each category. Uses the same data limits as admin users
 * for consistency; for very large datasets consider a materialized view or RPC.
 */
export async function getLeaderboardTopTen(): Promise<LeaderboardData> {
  const db = getSupabaseAdmin()

  const [rafflesRes, entriesRes] = await Promise.all([
    db
      .from('raffles')
      .select('id, created_by, creator_wallet, winner_wallet, status')
      .limit(5000),
    db
      .from('entries')
      .select('raffle_id, wallet_address, ticket_quantity')
      .eq('status', 'confirmed')
      .limit(20000),
  ])

  const raffles = (rafflesRes.data || []) as {
    id: string
    created_by: string | null
    creator_wallet: string | null
    winner_wallet: string | null
    status: string | null
  }[]
  const entries = (entriesRes.data || []) as {
    raffle_id: string
    wallet_address: string
    ticket_quantity: number
  }[]

  // Raffles entered: distinct raffle count per wallet
  const enteredByWallet = new Map<string, Set<string>>()
  for (const e of entries) {
    const w = normalizeWallet(e.wallet_address)
    if (!w) continue
    let set = enteredByWallet.get(w)
    if (!set) {
      set = new Set()
      enteredByWallet.set(w, set)
    }
    set.add(e.raffle_id)
  }
  const rafflesEntered = takeTopTen(
    Array.from(enteredByWallet.entries()).map(([wallet, set]) => ({
      wallet,
      value: set.size,
    }))
  )

  // Raffles created: count per creator
  const createdByWallet = new Map<string, number>()
  for (const r of raffles) {
    const w = normalizeWallet(r.creator_wallet ?? r.created_by)
    if (!w) continue
    createdByWallet.set(w, (createdByWallet.get(w) ?? 0) + 1)
  }
  const rafflesCreated = takeTopTen(
    Array.from(createdByWallet.entries()).map(([wallet, value]) => ({ wallet, value }))
  )

  // Tickets sold: per creator, sum of ticket_quantity for entries in their raffles
  const raffleToCreator = new Map<string, string>()
  for (const r of raffles) {
    const w = normalizeWallet(r.creator_wallet ?? r.created_by)
    if (w) raffleToCreator.set(r.id, w)
  }
  const ticketsByCreator = new Map<string, number>()
  for (const e of entries) {
    const creator = raffleToCreator.get(e.raffle_id)
    if (!creator) continue
    const qty = Number(e.ticket_quantity)
    if (!Number.isFinite(qty) || qty < 0) continue
    ticketsByCreator.set(creator, (ticketsByCreator.get(creator) ?? 0) + qty)
  }
  const ticketsSold = takeTopTen(
    Array.from(ticketsByCreator.entries()).map(([wallet, value]) => ({ wallet, value }))
  )

  // Raffles won: count of completed raffles where this wallet is the recorded winner
  const winsByWallet = new Map<string, number>()
  for (const r of raffles) {
    const winner = normalizeWallet(r.winner_wallet)
    if (!winner) continue
    if ((r.status || '').toLowerCase() !== 'completed') continue
    winsByWallet.set(winner, (winsByWallet.get(winner) ?? 0) + 1)
  }
  const rafflesWon = takeTopTen(
    Array.from(winsByWallet.entries()).map(([wallet, value]) => ({ wallet, value }))
  )

  return {
    rafflesEntered,
    rafflesCreated,
    ticketsSold,
    rafflesWon,
  }
}
