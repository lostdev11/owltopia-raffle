/**
 * Public leaderboard: top 10 by raffles entered, tickets purchased, raffles created, raffles won, and tickets sold (by creators).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

/** PostgREST page size; must paginate — a hard .limit() undercounts once row count exceeds the cap. */
const LEADERBOARD_PAGE_SIZE = 2500

export type LeaderboardEntry = {
  rank: number
  wallet: string
  value: number
}

export type LeaderboardData = {
  rafflesEntered: LeaderboardEntry[]
  ticketsPurchased: LeaderboardEntry[]
  rafflesCreated: LeaderboardEntry[]
  ticketsSold: LeaderboardEntry[]
  rafflesWon: LeaderboardEntry[]
}

function normalizeWallet(v: string | null | undefined): string {
  const s = typeof v === 'string' ? v.trim() : ''
  return s || ''
}

function takeTopTen(items: { wallet: string; value: number }[]): LeaderboardEntry[] {
  return items
    .sort((a, b) => b.value - a.value || a.wallet.localeCompare(b.wallet))
    .slice(0, 10)
    .map((item, i) => ({ rank: i + 1, wallet: item.wallet, value: item.value }))
}

/**
 * Count a leaderboard "win" once a winner is recorded and the raffle has left the pre-draw
 * states. Escrow raffles use `successful_pending_claims` until claims finish, then `completed`;
 * counting only `completed` undercounted wins on the leaderboard.
 */
function statusCountsAsRaffleWon(status: string | null): boolean {
  const s = (status || '').toLowerCase()
  return s === 'completed' || s === 'successful_pending_claims'
}

async function fetchAllLeaderboardRaffles(
  db: SupabaseClient
): Promise<
  {
    id: string
    created_by: string | null
    creator_wallet: string | null
    winner_wallet: string | null
    status: string | null
  }[]
> {
  const rows: {
    id: string
    created_by: string | null
    creator_wallet: string | null
    winner_wallet: string | null
    status: string | null
  }[] = []
  let from = 0
  for (;;) {
    const { data, error } = await db
      .from('raffles')
      .select('id, created_by, creator_wallet, winner_wallet, status')
      .order('id', { ascending: true })
      .range(from, from + LEADERBOARD_PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    const chunk = (data || []) as typeof rows
    rows.push(...chunk)
    if (chunk.length < LEADERBOARD_PAGE_SIZE) break
    from += LEADERBOARD_PAGE_SIZE
  }
  return rows
}

async function fetchAllConfirmedEntriesForLeaderboard(
  db: SupabaseClient
): Promise<{ raffle_id: string; wallet_address: string; ticket_quantity: number }[]> {
  const rows: { raffle_id: string; wallet_address: string; ticket_quantity: number }[] = []
  let from = 0
  for (;;) {
    const { data, error } = await db
      .from('entries')
      .select('raffle_id, wallet_address, ticket_quantity')
      .eq('status', 'confirmed')
      .order('id', { ascending: true })
      .range(from, from + LEADERBOARD_PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    const chunk = (data || []) as typeof rows
    rows.push(...chunk)
    if (chunk.length < LEADERBOARD_PAGE_SIZE) break
    from += LEADERBOARD_PAGE_SIZE
  }
  return rows
}

/**
 * Returns top 10 users for each category. Loads all confirmed entries and raffles via
 * keyset-stable pagination so totals stay correct as the dataset grows.
 */
export async function getLeaderboardTopTen(): Promise<LeaderboardData> {
  const db = getSupabaseAdmin()

  const [raffles, entries] = await Promise.all([
    fetchAllLeaderboardRaffles(db),
    fetchAllConfirmedEntriesForLeaderboard(db),
  ])

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

  // Tickets purchased: per buyer wallet, sum of ticket_quantity (confirmed entries)
  const purchasedByWallet = new Map<string, number>()
  for (const e of entries) {
    const w = normalizeWallet(e.wallet_address)
    if (!w) continue
    const qty = Number(e.ticket_quantity)
    if (!Number.isFinite(qty) || qty < 0) continue
    purchasedByWallet.set(w, (purchasedByWallet.get(w) ?? 0) + qty)
  }
  const ticketsPurchased = takeTopTen(
    Array.from(purchasedByWallet.entries()).map(([wallet, value]) => ({ wallet, value }))
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

  // Raffles won: raffles with a recorded winner after the draw (includes escrow pending claims)
  const winsByWallet = new Map<string, number>()
  for (const r of raffles) {
    const winner = normalizeWallet(r.winner_wallet)
    if (!winner) continue
    if (!statusCountsAsRaffleWon(r.status)) continue
    winsByWallet.set(winner, (winsByWallet.get(winner) ?? 0) + 1)
  }
  const rafflesWon = takeTopTen(
    Array.from(winsByWallet.entries()).map(([wallet, value]) => ({ wallet, value }))
  )

  return {
    rafflesEntered,
    ticketsPurchased,
    rafflesCreated,
    ticketsSold,
    rafflesWon,
  }
}
