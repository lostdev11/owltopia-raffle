/**
 * Admin-only: aggregate user (wallet) stats for the admin dashboard.
 */
import { getSupabaseAdmin } from '@/lib/supabase-admin'

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

/**
 * Returns aggregated stats per wallet (creators + entrants).
 * Uses reasonable limits; for large datasets consider pagination or a materialized view.
 */
export async function getAdminUsersAggregate(): Promise<AdminUserRow[]> {
  const db = getSupabaseAdmin()

  const [rafflesRes, entriesRes] = await Promise.all([
    db
      .from('raffles')
      .select('created_by, creator_wallet, status, creator_payout_amount, currency')
      .limit(3000),
    db
      .from('entries')
      .select('wallet_address, amount_paid, currency, status')
      .eq('status', 'confirmed')
      .limit(15000),
  ])

  const raffles = (rafflesRes.data || []) as {
    created_by: string | null
    creator_wallet: string | null
    status: string | null
    creator_payout_amount: number | null
    currency: string | null
  }[]
  const entries = (entriesRes.data || []) as {
    wallet_address: string
    amount_paid: number
    currency: string | null
    status: string
  }[]

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
