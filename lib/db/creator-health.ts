/**
 * Admin-only: per-creator signals for platform health (extensions, integrity, moderation).
 */
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export type CreatorHealthRow = {
  wallet: string
  /** Raffles tied to this wallet (creator_wallet or created_by). */
  rafflesTotal: number
  completed: number
  cancelled: number
  /**
   * Raffles whose end_time was extended past original_end_time (min-threshold extension at least once).
   */
  minTicketExtensions: number
  /** Raffle had edited_after_entries = true. */
  editedAfterEntries: number
  cancellationRequested: number
  /** Admin blocked purchases (e.g. escrow). */
  purchasesBlocked: number
  /** Completed but sold under half of max tickets (when max is set). */
  weakSellthrough: number
  /** Pending ticket entries across this creator's raffles (hurts Owl Vision until verified). */
  pendingEntries: number
  /** 0–100; higher is better. Heuristic for triage, not a guarantee. */
  healthScore: number
}

function normalizeWallet(v: string | null | undefined): string {
  const s = typeof v === 'string' ? v.trim() : ''
  return s || ''
}

function computeHealthScore(row: Omit<CreatorHealthRow, 'wallet' | 'healthScore'>): number {
  let h = 100
  h -= Math.min(row.minTicketExtensions * 6, 30)
  h -= Math.min(row.editedAfterEntries * 3, 15)
  h -= Math.min(row.cancellationRequested * 4, 12)
  h -= Math.min(row.purchasesBlocked * 10, 20)
  h -= Math.min(row.cancelled * 5, 15)
  h -= Math.min(row.weakSellthrough * 4, 12)
  h -= Math.min(Math.floor(row.pendingEntries / 4), 18)
  return Math.max(0, Math.round(h))
}

/**
 * Aggregate creator health metrics. Uses the same limits as admin user aggregates; scale up if needed.
 */
export async function getCreatorHealthRows(): Promise<CreatorHealthRow[]> {
  const db = getSupabaseAdmin()

  const [rafflesRes, entriesRes, pendingRes] = await Promise.all([
    db
      .from('raffles')
      .select(
        'id, created_by, creator_wallet, min_tickets, max_tickets, status, end_time, original_end_time, edited_after_entries, cancellation_requested_at, cancelled_at, purchases_blocked_at'
      )
      .limit(5000),
    db.from('entries').select('raffle_id, ticket_quantity, status').limit(80000),
    db.from('entries').select('raffle_id').eq('status', 'pending').limit(30000),
  ])

  const raffles = (rafflesRes.data || []) as {
    id: string
    created_by: string | null
    creator_wallet: string | null
    min_tickets: number | null
    max_tickets: number | null
    status: string | null
    end_time: string
    original_end_time: string | null
    edited_after_entries: boolean | null
    cancellation_requested_at: string | null
    cancelled_at: string | null
    purchases_blocked_at: string | null
  }[]

  const entries = (entriesRes.data || []) as {
    raffle_id: string
    ticket_quantity: number
    status: string
  }[]

  const pendingList = (pendingRes.data || []) as { raffle_id: string }[]

  const soldByRaffle = new Map<string, number>()
  for (const e of entries) {
    if (e.status !== 'confirmed') continue
    const q = Number(e.ticket_quantity)
    if (!Number.isFinite(q) || q <= 0) continue
    soldByRaffle.set(e.raffle_id, (soldByRaffle.get(e.raffle_id) ?? 0) + q)
  }

  const pendingByRaffle = new Map<string, number>()
  for (const p of pendingList) {
    pendingByRaffle.set(p.raffle_id, (pendingByRaffle.get(p.raffle_id) ?? 0) + 1)
  }

  const map = new Map<
    string,
    Omit<CreatorHealthRow, 'wallet' | 'healthScore'>
  >()

  const bump = (wallet: string) => {
    let row = map.get(wallet)
    if (!row) {
      row = {
        rafflesTotal: 0,
        completed: 0,
        cancelled: 0,
        minTicketExtensions: 0,
        editedAfterEntries: 0,
        cancellationRequested: 0,
        purchasesBlocked: 0,
        weakSellthrough: 0,
        pendingEntries: 0,
      }
      map.set(wallet, row)
    }
    return row
  }

  for (const r of raffles) {
    const wallet = normalizeWallet(r.creator_wallet ?? r.created_by)
    if (!wallet) continue

    const row = bump(wallet)
    row.rafflesTotal += 1

    const sold = soldByRaffle.get(r.id) ?? 0
    const maxT = r.max_tickets != null ? Number(r.max_tickets) : null
    const st = (r.status || '').toLowerCase()

    if (st === 'completed') {
      row.completed += 1
      if (maxT != null && Number.isFinite(maxT) && maxT > 0 && sold < maxT * 0.5) {
        row.weakSellthrough += 1
      }
    }
    if (st === 'cancelled' || r.cancelled_at) {
      row.cancelled += 1
    }

    const orig = r.original_end_time ? new Date(r.original_end_time).getTime() : null
    const end = r.end_time ? new Date(r.end_time).getTime() : null
    if (orig != null && end != null && end > orig + 60_000) {
      row.minTicketExtensions += 1
    }

    if (r.edited_after_entries === true) {
      row.editedAfterEntries += 1
    }
    if (r.cancellation_requested_at) {
      row.cancellationRequested += 1
    }
    if (r.purchases_blocked_at) {
      row.purchasesBlocked += 1
    }

    const pend = pendingByRaffle.get(r.id) ?? 0
    if (pend > 0) {
      row.pendingEntries += pend
    }
  }

  const out: CreatorHealthRow[] = []
  for (const [wallet, raw] of map.entries()) {
    if (raw.rafflesTotal === 0) continue
    out.push({
      wallet,
      ...raw,
      healthScore: computeHealthScore(raw),
    })
  }

  out.sort((a, b) => a.healthScore - b.healthScore || b.rafflesTotal - a.rafflesTotal)
  return out
}
