import { createHash } from 'node:crypto'
import type { DrawEntryLike, DrawLedger, DrawLedgerRange } from '@/lib/raffles/draw/types'

/**
 * Confirmed, non-refunded entries only — same filter as historical selectWinner.
 */
export function filterDrawableEntries(entries: DrawEntryLike[]): DrawEntryLike[] {
  return entries.filter((e) => e.status === 'confirmed' && !e.refunded_at)
}

/**
 * Canonical ledger: aggregate tickets per wallet, sort wallets lexicographically,
 * assign contiguous index ranges. Deterministic regardless of fetch order.
 */
export function buildDrawLedger(entries: DrawEntryLike[]): DrawLedger {
  const confirmed = filterDrawableEntries(entries)
  const walletTickets = new Map<string, number>()

  for (const entry of confirmed) {
    const wallet = (entry.wallet_address || '').trim()
    if (!wallet) continue
    const qty = Math.max(0, Math.floor(Number(entry.ticket_quantity) || 0))
    if (qty <= 0) continue
    walletTickets.set(wallet, (walletTickets.get(wallet) || 0) + qty)
  }

  const wallets = Array.from(walletTickets.keys()).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const ranges: DrawLedgerRange[] = []
  let cursor = 0

  for (const wallet of wallets) {
    const tickets = walletTickets.get(wallet) || 0
    if (tickets <= 0) continue
    const startIndex = cursor
    const endIndex = cursor + tickets
    ranges.push({ wallet, tickets, startIndex, endIndex })
    cursor = endIndex
  }

  const ledgerHash = hashLedgerRanges(ranges)
  return { ranges, soldCount: cursor, ledgerHash }
}

/** Stable hash: one `wallet:tickets` line per range, newline-joined, SHA-256 hex. */
export function hashLedgerRanges(ranges: Pick<DrawLedgerRange, 'wallet' | 'tickets'>[]): string {
  const body = ranges.map((r) => `${r.wallet}:${r.tickets}`).join('\n')
  return createHash('sha256').update(body, 'utf8').digest('hex')
}

export function walletForTicketIndex(
  ranges: DrawLedgerRange[],
  winnerIndex: number
): string | null {
  if (!Number.isInteger(winnerIndex) || winnerIndex < 0) return null
  for (const range of ranges) {
    if (winnerIndex >= range.startIndex && winnerIndex < range.endIndex) {
      return range.wallet
    }
  }
  return null
}
