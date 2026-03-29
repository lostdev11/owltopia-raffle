/**
 * Admin-only: aggregate user (wallet) stats for the admin dashboard.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

/** Same as leaderboard: paginate instead of .limit() so aggregates stay correct at scale. */
const ADMIN_AGG_PAGE_SIZE = 2500

export type AdminUserRow = {
  wallet: string
  rafflesCreated: number
  creatorRevenue: number
  creatorRevenueByCurrency: Record<string, number>
  entriesCount: number
  totalSpent: number
  totalSpentByCurrency: Record<string, number>
}

function normalizeWallet(v: string | null | undefined): string {
  const s = typeof v === 'string' ? v.trim() : ''
  return s || ''
}

async function fetchAllRafflesForAdminAgg(
  db: SupabaseClient
): Promise<
  {
    created_by: string | null
    creator_wallet: string | null
    status: string | null
    creator_payout_amount: number | null
    currency: string | null
  }[]
> {
  const rows: {
    created_by: string | null
    creator_wallet: string | null
    status: string | null
    creator_payout_amount: number | null
    currency: string | null
  }[] = []
  let from = 0
  for (;;) {
    const { data, error } = await db
      .from('raffles')
      .select('created_by, creator_wallet, status, creator_payout_amount, currency')
      .order('id', { ascending: true })
      .range(from, from + ADMIN_AGG_PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    const chunk = (data || []) as typeof rows
    rows.push(...chunk)
    if (chunk.length < ADMIN_AGG_PAGE_SIZE) break
    from += ADMIN_AGG_PAGE_SIZE
  }
  return rows
}

async function fetchAllConfirmedEntriesForAdminAgg(
  db: SupabaseClient
): Promise<
  { wallet_address: string; amount_paid: number; currency: string | null; status: string }[]
> {
  const rows: { wallet_address: string; amount_paid: number; currency: string | null; status: string }[] =
    []
  let from = 0
  for (;;) {
    const { data, error } = await db
      .from('entries')
      .select('wallet_address, amount_paid, currency, status')
      .eq('status', 'confirmed')
      .order('id', { ascending: true })
      .range(from, from + ADMIN_AGG_PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    const chunk = (data || []) as typeof rows
    rows.push(...chunk)
    if (chunk.length < ADMIN_AGG_PAGE_SIZE) break
    from += ADMIN_AGG_PAGE_SIZE
  }
  return rows
}

/**
 * Returns aggregated stats per wallet (creators + entrants).
 * Loads all raffles and confirmed entries via stable pagination (aligned with public leaderboard).
 */
export async function getAdminUsersAggregate(): Promise<AdminUserRow[]> {
  const db = getSupabaseAdmin()

  const [raffles, entries] = await Promise.all([
    fetchAllRafflesForAdminAgg(db),
    fetchAllConfirmedEntriesForAdminAgg(db),
  ])

  const map = new Map<
    string,
    {
      rafflesCreated: number
      creatorRevenueByCurrency: Record<string, number>
      entriesCount: number
      totalSpentByCurrency: Record<string, number>
    }
  >()

  for (const r of raffles) {
    const wallet = normalizeWallet(r.creator_wallet ?? r.created_by)
    if (!wallet) continue
    let row = map.get(wallet)
    if (!row) {
      row = {
        rafflesCreated: 0,
        creatorRevenueByCurrency: {},
        entriesCount: 0,
        totalSpentByCurrency: {},
      }
      map.set(wallet, row)
    }
    row.rafflesCreated += 1
    if (r.status === 'completed' && r.creator_payout_amount != null && Number(r.creator_payout_amount) > 0) {
      const cur = (r.currency as string) || 'SOL'
      row.creatorRevenueByCurrency[cur] = (row.creatorRevenueByCurrency[cur] ?? 0) + Number(r.creator_payout_amount)
    }
  }

  for (const e of entries) {
    const wallet = normalizeWallet(e.wallet_address)
    if (!wallet) continue
    let row = map.get(wallet)
    if (!row) {
      row = {
        rafflesCreated: 0,
        creatorRevenueByCurrency: {},
        entriesCount: 0,
        totalSpentByCurrency: {},
      }
      map.set(wallet, row)
    }
    row.entriesCount += 1
    const amt = Number(e.amount_paid)
    if (Number.isFinite(amt) && amt > 0) {
      const cur = (e.currency as string) || 'SOL'
      row.totalSpentByCurrency[cur] = (row.totalSpentByCurrency[cur] ?? 0) + amt
    }
  }

  const out: AdminUserRow[] = []
  for (const [wallet, row] of map.entries()) {
    const creatorRevenue = Object.values(row.creatorRevenueByCurrency).reduce((a, b) => a + b, 0)
    const totalSpent = Object.values(row.totalSpentByCurrency).reduce((a, b) => a + b, 0)
    out.push({
      wallet,
      rafflesCreated: row.rafflesCreated,
      creatorRevenue,
      creatorRevenueByCurrency: { ...row.creatorRevenueByCurrency },
      entriesCount: row.entriesCount,
      totalSpent,
      totalSpentByCurrency: { ...row.totalSpentByCurrency },
    })
  }

  out.sort((a, b) => b.creatorRevenue - a.creatorRevenue)
  return out
}
