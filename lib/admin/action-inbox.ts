import { listRaffleUnrefundedConfirmedEntryCounts } from '@/lib/db/entries'
import { listDevTasks } from '@/lib/db/dev-tasks'
import { listPartnerProgramApplications } from '@/lib/db/partner-program-applications'
import {
  calculateTicketsSold,
  getEffectiveDrawThresholdTickets,
} from '@/lib/db/raffles'
import { isPartnerSplPrizeRaffle } from '@/lib/partner-prize-tokens'
import { RAFFLES_PENDING_CANCELLATION_QUEUE_STATUSES } from '@/lib/raffles/list-query-statuses'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import type { Entry, Raffle } from '@/lib/types'

export type AdminActionInboxSeverity = 'critical' | 'warning' | 'info'

export type AdminActionInboxItemType =
  | 'cancellation_pending'
  | 'manual_refund'
  | 'ready_to_draw'
  | 'second_round_at_risk'
  | 'pending_entries'
  | 'prize_return_pending'
  | 'partner_application_new'
  | 'launch_submission_pending'
  | 'open_dev_task'

export interface AdminActionInboxItem {
  id: string
  type: AdminActionInboxItemType
  severity: AdminActionInboxSeverity
  /** Changes when underlying state changes — used for mark-as-read invalidation. */
  fingerprint: string
  title: string
  detail: string
  href: string
  occurredAt: string | null
}

const MS_HOUR = 60 * 60 * 1000
const MS_DAY = 24 * MS_HOUR

const SEVERITY_RANK: Record<AdminActionInboxSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
}

function statusNeedsRefundRecording(status: string | null | undefined): boolean {
  const s = (status ?? '').trim().toLowerCase()
  return s === 'failed_refund_available' || s === 'pending_min_not_met' || s === 'cancelled'
}

function raffleNeedsAdminPrizeReturn(raffle: {
  status?: string | null
  prize_deposited_at?: string | null
  prize_returned_at?: string | null
  nft_transfer_transaction?: string | null
  prize_type?: string | null
  nft_mint_address?: string | null
  nft_token_id?: string | null
  prize_currency?: string | null
}): boolean {
  const st = (raffle.status ?? '').toLowerCase()
  if (st !== 'failed_refund_available' && st !== 'cancelled') return false
  if (!raffle.prize_deposited_at) return false
  if (raffle.prize_returned_at) return false
  if ((raffle.nft_transfer_transaction ?? '').trim()) return false

  if (isPartnerSplPrizeRaffle(raffle as Raffle)) return true
  const assetId =
    (raffle.nft_mint_address || '').trim() || (raffle.nft_token_id || '').trim()
  return (raffle.prize_type || '').toLowerCase() === 'nft' && !!assetId
}

export type SecondRoundRiskInput = {
  status?: string | null
  end_time?: string | null
  time_extension_count?: number | null
  minTickets: number | null
  ticketsSold: number
  now?: Date
}

export type SecondRoundRiskResult =
  | { atRisk: false }
  | { atRisk: true; reason: string; hoursLeft: number; daysLeft: number; pct: number }

/**
 * 2nd selling round (time_extension_count >= 1) may fail min threshold when:
 * - <= 48h until end, OR
 * - < 25% of min sold with < 7 days left.
 */
export function evaluateSecondRoundAtRisk(input: SecondRoundRiskInput): SecondRoundRiskResult {
  const now = input.now ?? new Date()
  if ((input.status ?? '').toLowerCase() !== 'live') return { atRisk: false }
  if ((input.time_extension_count ?? 0) < 1) return { atRisk: false }

  const min = input.minTickets
  if (min == null || min <= 0) return { atRisk: false }
  if (input.ticketsSold >= min) return { atRisk: false }

  const endMs = new Date(input.end_time ?? '').getTime()
  if (!Number.isFinite(endMs) || endMs <= now.getTime()) return { atRisk: false }

  const msLeft = endMs - now.getTime()
  const hoursLeft = msLeft / MS_HOUR
  const daysLeft = msLeft / MS_DAY
  const pct = input.ticketsSold / min

  if (hoursLeft <= 48) {
    return {
      atRisk: true,
      reason: `${Math.max(1, Math.round(hoursLeft))}h left · ${input.ticketsSold}/${min} tickets (${Math.round(pct * 100)}%)`,
      hoursLeft,
      daysLeft,
      pct,
    }
  }

  if (pct < 0.25 && daysLeft < 7) {
    return {
      atRisk: true,
      reason: `${(Math.round(daysLeft * 10) / 10).toFixed(1)}d left · ${input.ticketsSold}/${min} tickets (${Math.round(pct * 100)}%)`,
      hoursLeft,
      daysLeft,
      pct,
    }
  }

  return { atRisk: false }
}

async function fetchTicketsSoldByRaffleIds(raffleIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (raffleIds.length === 0) return out

  const admin = getSupabaseAdmin()
  const chunkSize = 80
  for (let i = 0; i < raffleIds.length; i += chunkSize) {
    const slice = raffleIds.slice(i, i + chunkSize)
    const { data, error } = await admin
      .from('entries')
      .select('raffle_id, ticket_quantity, status, refunded_at')
      .in('raffle_id', slice)
      .eq('status', 'confirmed')
      .is('refunded_at', null)

    if (error) {
      console.error('[action-inbox] entries fetch:', error)
      continue
    }

    const grouped = new Map<string, Entry[]>()
    for (const row of data ?? []) {
      const rid = String((row as { raffle_id?: string }).raffle_id ?? '').trim()
      if (!rid) continue
      const list = grouped.get(rid) ?? []
      list.push(row as Entry)
      grouped.set(rid, list)
    }

    for (const [rid, entries] of grouped) {
      out.set(rid, calculateTicketsSold(entries))
    }
  }

  return out
}

function sortInboxItems(items: AdminActionInboxItem[]): AdminActionInboxItem[] {
  return [...items].sort((a, b) => {
    const sev = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    if (sev !== 0) return sev
    const aTs = a.occurredAt ? new Date(a.occurredAt).getTime() : 0
    const bTs = b.occurredAt ? new Date(b.occurredAt).getTime() : 0
    return bTs - aTs
  })
}

/**
 * Unresolved admin actions for Owl Vision inbox (full admins).
 */
export async function buildAdminActionInbox(now = new Date()): Promise<AdminActionInboxItem[]> {
  const admin = getSupabaseAdmin()
  const items: AdminActionInboxItem[] = []

  const [
    cancellationRes,
    readyToDrawRes,
    extendedLiveRes,
    prizeReturnRes,
    pendingEntriesRes,
    devTasks,
    partnerApps,
    unrefundedRows,
    pendingLaunchesRes,
  ] = await Promise.all([
    admin
      .from('raffles')
      .select(
        'id, slug, title, status, cancellation_requested_at, cancellation_fee_paid_at, updated_at'
      )
      .or('cancellation_requested_at.not.is.null,cancellation_fee_paid_at.not.is.null')
      .in('status', [...RAFFLES_PENDING_CANCELLATION_QUEUE_STATUSES])
      .order('cancellation_requested_at', { ascending: false }),
    admin
      .from('raffles')
      .select('id, slug, title, status, end_time, winner_selected_at, updated_at')
      .eq('status', 'ready_to_draw')
      .is('winner_selected_at', null)
      .order('end_time', { ascending: false }),
    admin
      .from('raffles')
      .select(
        'id, slug, title, status, end_time, time_extension_count, min_tickets, prize_type, floor_price, ticket_price, updated_at'
      )
      .eq('status', 'live')
      .gte('time_extension_count', 1)
      .order('end_time', { ascending: true }),
    admin
      .from('raffles')
      .select(
        'id, slug, title, status, prize_deposited_at, prize_returned_at, nft_transfer_transaction, prize_type, nft_mint_address, nft_token_id, prize_currency, cancelled_at, updated_at'
      )
      .in('status', ['cancelled', 'failed_refund_available'])
      .not('prize_deposited_at', 'is', null)
      .is('prize_returned_at', null)
      .order('updated_at', { ascending: false }),
    admin
      .from('entries')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .not('transaction_signature', 'is', null),
    listDevTasks(),
    listPartnerProgramApplications(),
    listRaffleUnrefundedConfirmedEntryCounts(),
    admin
      .from('owl_center_launches')
      .select('id, name, symbol, creator_wallet, total_supply, status, created_at, updated_at')
      .eq('status', 'PENDING_REVIEW')
      .neq('slug', 'gen2')
      .order('created_at', { ascending: false }),
  ])

  for (const row of cancellationRes.data ?? []) {
    const r = row as {
      id: string
      slug: string | null
      title: string | null
      status: string | null
      cancellation_requested_at: string | null
      cancellation_fee_paid_at: string | null
      updated_at: string | null
    }
    const slug = (r.slug ?? '').trim()
    if (!r.id || !slug) continue
    const occurredAt = r.cancellation_requested_at ?? r.cancellation_fee_paid_at
    const feeNote = r.cancellation_fee_paid_at ? 'Cancellation fee paid' : 'Fee not recorded yet'
    items.push({
      id: `cancellation:${r.id}`,
      type: 'cancellation_pending',
      severity: 'critical',
      fingerprint: `${occurredAt ?? ''}|${r.status ?? ''}|${r.cancellation_fee_paid_at ?? ''}`,
      title: (r.title ?? 'Untitled raffle').trim() || 'Untitled raffle',
      detail: `Creator requested cancellation · ${feeNote}`,
      href: `/admin/raffles/${r.id}`,
      occurredAt,
    })
  }

  for (const row of readyToDrawRes.data ?? []) {
    const r = row as {
      id: string
      slug: string | null
      title: string | null
      end_time: string | null
      updated_at: string | null
    }
    const slug = (r.slug ?? '').trim()
    if (!r.id || !slug) continue
    items.push({
      id: `ready_to_draw:${r.id}`,
      type: 'ready_to_draw',
      severity: 'warning',
      fingerprint: `${r.end_time ?? ''}|${r.updated_at ?? ''}`,
      title: (r.title ?? 'Untitled raffle').trim() || 'Untitled raffle',
      detail: 'Ended — ready to draw, no winner selected yet',
      href: `/admin/raffles/${r.id}`,
      occurredAt: r.end_time,
    })
  }

  const extendedRows = (extendedLiveRes.data ?? []) as Array<{
    id: string
    slug: string | null
    title: string | null
    status: string | null
    end_time: string | null
    time_extension_count: number | null
    min_tickets: number | null
    prize_type: string | null
    floor_price: string | null
    ticket_price: number | null
    updated_at: string | null
  }>
  const extendedIds = extendedRows.map((r) => r.id).filter(Boolean)
  const ticketsByRaffle = await fetchTicketsSoldByRaffleIds(extendedIds)

  for (const r of extendedRows) {
    const slug = (r.slug ?? '').trim()
    if (!r.id || !slug) continue
    const ticketsSold = ticketsByRaffle.get(r.id) ?? 0
    const minTickets = getEffectiveDrawThresholdTickets(r as Raffle)
    const risk = evaluateSecondRoundAtRisk({
      status: r.status,
      end_time: r.end_time,
      time_extension_count: r.time_extension_count,
      minTickets,
      ticketsSold,
      now,
    })
    if (!risk.atRisk) continue
    items.push({
      id: `second_round_at_risk:${r.id}`,
      type: 'second_round_at_risk',
      severity: 'warning',
      fingerprint: `${r.end_time ?? ''}|${ticketsSold}|${minTickets ?? ''}|${r.updated_at ?? ''}`,
      title: (r.title ?? 'Untitled raffle').trim() || 'Untitled raffle',
      detail: `2nd round at risk — ${risk.reason}`,
      href: `/admin/raffles/${r.id}`,
      occurredAt: r.end_time,
    })
  }

  for (const row of prizeReturnRes.data ?? []) {
    const r = row as {
      id: string
      slug: string | null
      title: string | null
      status: string | null
      prize_deposited_at: string | null
      prize_returned_at: string | null
      nft_transfer_transaction: string | null
      prize_type: string | null
      nft_mint_address: string | null
      nft_token_id: string | null
      prize_currency: string | null
      cancelled_at: string | null
      updated_at: string | null
    }
    if (!raffleNeedsAdminPrizeReturn(r)) continue
    const slug = (r.slug ?? '').trim()
    if (!r.id || !slug) continue
    items.push({
      id: `prize_return_pending:${r.id}`,
      type: 'prize_return_pending',
      severity: 'warning',
      fingerprint: `${r.status ?? ''}|${r.prize_deposited_at ?? ''}|${r.updated_at ?? ''}`,
      title: (r.title ?? 'Untitled raffle').trim() || 'Untitled raffle',
      detail: `Escrowed prize not returned (${r.status ?? 'unknown'})`,
      href: `/admin/raffles/${r.id}`,
      occurredAt: r.cancelled_at ?? r.updated_at,
    })
  }

  if (unrefundedRows.length > 0) {
    const raffleIds = unrefundedRows.map((x) => x.raffleId)
    const metaChunks: Array<{
      id: string
      slug: string
      title: string
      status: string | null
      currency: string | null
      updated_at: string | null
    }> = []
    for (let i = 0; i < raffleIds.length; i += 80) {
      const slice = raffleIds.slice(i, i + 80)
      const { data } = await admin
        .from('raffles')
        .select('id, slug, title, status, currency, updated_at')
        .in('id', slice)
      for (const row of data ?? []) {
        const m = row as {
          id: string
          slug: string
          title: string
          status: string | null
          currency: string | null
          updated_at: string | null
        }
        if (m?.id) metaChunks.push(m)
      }
    }
    const metaById = new Map(metaChunks.map((m) => [m.id, m]))

    for (const row of unrefundedRows) {
      const m = metaById.get(row.raffleId)
      if (!m || !statusNeedsRefundRecording(m.status)) continue
      const slug = (m.slug ?? '').trim()
      if (!slug) continue
      items.push({
        id: `manual_refund:${row.raffleId}`,
        type: 'manual_refund',
        severity: 'warning',
        fingerprint: `${row.unrefundedEntryCount}|${m.status ?? ''}|${m.updated_at ?? ''}`,
        title: (m.title ?? 'Untitled raffle').trim() || 'Untitled raffle',
        detail: `${row.unrefundedEntryCount} confirmed ticket row${row.unrefundedEntryCount === 1 ? '' : 's'} need refund marking · ${m.status ?? '—'}${m.currency ? ` · ${m.currency}` : ''}`,
        href: `/admin/raffles/${row.raffleId}`,
        occurredAt: m.updated_at,
      })
    }
  }

  const pendingEntryCount = pendingEntriesRes.count ?? 0
  if (pendingEntryCount > 0) {
    items.push({
      id: 'pending_entries:aggregate',
      type: 'pending_entries',
      severity: 'info',
      fingerprint: String(pendingEntryCount),
      title: 'Pending ticket verifications',
      detail: `${pendingEntryCount} pending entr${pendingEntryCount === 1 ? 'y has' : 'ies have'} a saved tx signature — try bulk re-verify`,
      href: '/admin#pending-entries-reverify',
      occurredAt: null,
    })
  }

  for (const row of pendingLaunchesRes.data ?? []) {
    const l = row as {
      id: string
      name: string | null
      symbol: string | null
      creator_wallet: string | null
      total_supply: number | null
      created_at: string | null
      updated_at: string | null
    }
    if (!l.id) continue
    const creator = (l.creator_wallet ?? '').trim()
    const creatorShort = creator ? `${creator.slice(0, 6)}…${creator.slice(-4)}` : 'unknown wallet'
    items.push({
      id: `launch_submission:${l.id}`,
      type: 'launch_submission_pending',
      severity: 'warning',
      fingerprint: `${l.updated_at ?? ''}`,
      title: (l.name ?? 'Untitled collection').trim() || 'Untitled collection',
      detail: `Launchpad submission awaiting review · ${l.total_supply ?? '—'} supply · creator ${creatorShort}`,
      href: `/admin/owl-center/collections/${l.id}/assets`,
      occurredAt: l.created_at,
    })
  }

  for (const app of partnerApps) {
    if ((app.status ?? '').toLowerCase() !== 'new') continue
    items.push({
      id: `partner_application:${app.id}`,
      type: 'partner_application_new',
      severity: 'info',
      fingerprint: `${app.status}|${app.updated_at}`,
      title: app.project_name?.trim() || 'Partner application',
      detail: `New partner application from ${app.contact_handle?.trim() || 'unknown contact'}`,
      href: '/admin/partner-applications',
      occurredAt: app.created_at,
    })
  }

  for (const task of devTasks) {
    if (task.status !== 'open') continue
    items.push({
      id: `dev_task:${task.id}`,
      type: 'open_dev_task',
      severity: 'info',
      fingerprint: `${task.status}|${task.updated_at}`,
      title: task.title.trim() || 'Dev task',
      detail: 'Open dev task on Owl Vision backlog',
      href: '/admin#dev-tasks',
      occurredAt: task.created_at,
    })
  }

  return sortInboxItems(items)
}
