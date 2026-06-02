import type { Entry, RaffleMilestone } from '@/lib/types'
import { calculateTicketsSold } from '@/lib/db/raffles'
import {
  milestoneTriggerTicketTarget,
  type RaffleForMilestoneTarget,
} from '@/lib/raffles/milestones/validation'

export type WalletTicketRow = { wallet: string; tickets: number }

export function aggregateWalletTickets(entries: Entry[]): WalletTicketRow[] {
  const map = new Map<string, number>()
  for (const entry of entries) {
    if (entry.status !== 'confirmed' || entry.refunded_at) continue
    const w = entry.wallet_address.trim()
    const qty = Math.max(0, Math.floor(Number(entry.ticket_quantity ?? 0)))
    if (!w || qty <= 0) continue
    map.set(w, (map.get(w) ?? 0) + qty)
  }
  return Array.from(map.entries())
    .map(([wallet, tickets]) => ({ wallet, tickets }))
    .filter((r) => r.tickets > 0)
}

export function milestoneTargetTickets(
  raffle: RaffleForMilestoneTarget,
  milestone: Pick<RaffleMilestone, 'trigger_type' | 'trigger_value'>
): number {
  return milestoneTriggerTicketTarget(raffle, milestone)
}

export function isMilestoneUnlockedBySales(
  raffle: RaffleForMilestoneTarget,
  milestone: Pick<RaffleMilestone, 'trigger_type' | 'trigger_value'>,
  ticketsSold: number
): boolean {
  return ticketsSold >= milestoneTargetTickets(raffle, milestone)
}

export function pickRandomWalletWeighted(
  rows: WalletTicketRow[],
  exclude: Set<string>
): string | null {
  const eligible = rows.filter((r) => !exclude.has(r.wallet))
  const total = eligible.reduce((s, r) => s + r.tickets, 0)
  if (total <= 0 || eligible.length === 0) return null
  const pick = Math.floor(Math.random() * total)
  let cumulative = 0
  for (const row of eligible) {
    cumulative += row.tickets
    if (pick < cumulative) return row.wallet
  }
  return eligible[eligible.length - 1].wallet
}

export function pickTopBuyerWallet(
  rows: WalletTicketRow[],
  exclude: Set<string>
): string | null {
  const eligible = rows.filter((r) => !exclude.has(r.wallet))
  if (eligible.length === 0) return null
  const maxTickets = Math.max(...eligible.map((r) => r.tickets))
  const tied = eligible.filter((r) => r.tickets === maxTickets)
  if (tied.length === 1) return tied[0].wallet
  const idx = Math.floor(Math.random() * tied.length)
  return tied[idx].wallet
}

export function resolveMilestoneWinnerWallet(params: {
  milestone: Pick<RaffleMilestone, 'winner_mode'>
  entries: Entry[]
  excludeWallets: Set<string>
  selectionMode: 'creator_triggered_random' | 'auto_random' | 'auto_top_buyer'
}): string | null {
  const rows = aggregateWalletTickets(params.entries)
  const mode =
    params.selectionMode === 'auto_top_buyer' || params.milestone.winner_mode === 'top_buyer'
      ? 'top_buyer'
      : 'random'

  if (mode === 'top_buyer') {
    return pickTopBuyerWallet(rows, params.excludeWallets)
  }
  return pickRandomWalletWeighted(rows, params.excludeWallets)
}

export function ticketsSoldFromEntries(entries: Entry[]): number {
  return calculateTicketsSold(entries)
}
