import type { Entry, Raffle } from '@/lib/types'
import { isAdmin } from '@/lib/db/admins'
import { getActivePartnerCommunityWalletSet } from '@/lib/raffles/partner-communities'

export type EntrantExportRow = {
  wallet_address: string
  total_tickets: number
  first_entered_at: string
  last_entered_at: string
}

function escapeCsvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

/**
 * Confirmed, non-refunded ticket rows only — one row per wallet with summed tickets.
 */
export function aggregateConfirmedEntrantsForExport(entries: Entry[]): EntrantExportRow[] {
  const map = new Map<string, { tickets: number; first: string; last: string }>()
  for (const e of entries) {
    if (e.status !== 'confirmed') continue
    if (e.refunded_at) continue
    const addr = (e.wallet_address || '').trim()
    if (!addr) continue
    const t = Math.max(0, Math.floor(Number(e.ticket_quantity) || 0))
    const created = (e.created_at || '').trim()
    const cur = map.get(addr)
    if (!cur) {
      map.set(addr, { tickets: t, first: created, last: created })
    } else {
      cur.tickets += t
      if (created && (!cur.first || created < cur.first)) cur.first = created
      if (created && (!cur.last || created > cur.last)) cur.last = created
    }
  }
  return [...map.entries()]
    .map(([wallet_address, v]) => ({
      wallet_address,
      total_tickets: v.tickets,
      first_entered_at: v.first,
      last_entered_at: v.last,
    }))
    .sort((a, b) => a.wallet_address.localeCompare(b.wallet_address))
}

export function buildEntrantExportCsv(rows: EntrantExportRow[]): string {
  const header = 'wallet_address,total_tickets,first_entered_at,last_entered_at'
  const lines = rows.map((r) =>
    [
      escapeCsvField(r.wallet_address),
      String(r.total_tickets),
      escapeCsvField(r.first_entered_at),
      escapeCsvField(r.last_entered_at),
    ].join(',')
  )
  return `\uFEFF${header}\n${lines.join('\n')}`
}

export function sanitizeExportFilenameSegment(slug: string): string {
  const s = slug.trim().slice(0, 80)
  const cleaned = s.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return cleaned || 'raffle'
}

/**
 * Site admins: any raffle. Active partner allowlist: only raffles where this wallet is the creator.
 */
export async function canExportRaffleEntrantCsv(sessionWallet: string, raffle: Raffle): Promise<boolean> {
  const w = sessionWallet.trim()
  if (!w) return false
  if (await isAdmin(w)) return true
  const partners = await getActivePartnerCommunityWalletSet()
  if (!partners.has(w)) return false
  const cw = (raffle.creator_wallet || '').trim()
  const cb = (raffle.created_by || '').trim()
  return cw === w || cb === w
}
