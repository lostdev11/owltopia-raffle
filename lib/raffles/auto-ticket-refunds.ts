/**
 * Server-driven ticket refunds from funds escrow (failed/cancelled raffles).
 * Buyer claim-refund remains as fallback; this clears the liability backlog.
 */
import {
  acquireEntryRefundLock,
  clearEntryRefundLock,
  markEntryRefunded,
} from '@/lib/db/entries'
import { getRaffleById } from '@/lib/db/raffles'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import {
  entryHasOnChainRefundAmount,
  noPaymentRefundSignature,
} from '@/lib/raffles/entry-refund-amount'
import { refundEntryFromFundsEscrow } from '@/lib/raffles/funds-escrow'
import { raffleUsesFundsEscrow } from '@/lib/raffles/ticket-escrow-policy'
import type { TicketRefundLedgerSource } from '@/lib/db/ticket-refund-ledger'
import type { Entry, Raffle } from '@/lib/types'

const COVERAGE_ERROR_RE = /cannot cover outstanding liability|Funds escrow is short|not configured/i

export type AutoTicketRefundResult = {
  attempted: number
  refunded: number
  skipped: number
  failed: number
  stoppedEarly: boolean
  stopReason: string | null
  errors: Array<{ entryId: string; error: string }>
}

async function refundOneEntry(params: {
  raffle: Raffle
  entry: Entry
  source: TicketRefundLedgerSource
}): Promise<{ ok: true; signature: string } | { ok: false; error: string; coverage?: boolean }> {
  const { raffle, entry, source } = params
  const { acquired } = await acquireEntryRefundLock(entry.id)
  if (!acquired) {
    return { ok: false, error: 'Refund lock not acquired' }
  }

  try {
    if (!entryHasOnChainRefundAmount(entry)) {
      const signature = noPaymentRefundSignature(entry.id)
      await markEntryRefunded(entry.id, signature, { source: 'zero_payment' })
      return { ok: true, signature }
    }

    const result = await refundEntryFromFundsEscrow(raffle, entry)
    if (!result.ok || !result.signature) {
      await clearEntryRefundLock(entry.id)
      const error =
        !result.ok && typeof result.error === 'string' && result.error.trim()
          ? result.error
          : 'Escrow refund failed'
      return { ok: false, error, coverage: COVERAGE_ERROR_RE.test(error) }
    }

    await markEntryRefunded(entry.id, result.signature, { source })
    return { ok: true, signature: result.signature }
  } catch (e) {
    await clearEntryRefundLock(entry.id)
    const error = e instanceof Error ? e.message : String(e)
    return { ok: false, error, coverage: COVERAGE_ERROR_RE.test(error) }
  }
}

/** Auto-refund confirmed unrefunded entries for one raffle (cap per call). */
export async function autoRefundTicketEntriesForRaffle(params: {
  raffleId: string
  source: Extract<TicketRefundLedgerSource, 'auto_finalize' | 'auto_cron'>
  limit?: number
}): Promise<AutoTicketRefundResult> {
  const limit = Math.max(1, Math.min(params.limit ?? 40, 80))
  const out: AutoTicketRefundResult = {
    attempted: 0,
    refunded: 0,
    skipped: 0,
    failed: 0,
    stoppedEarly: false,
    stopReason: null,
    errors: [],
  }

  const raffle = await getRaffleById(params.raffleId)
  if (!raffle) {
    out.stoppedEarly = true
    out.stopReason = 'Raffle not found'
    return out
  }
  if (!raffleUsesFundsEscrow(raffle)) {
    out.skipped = 1
    out.stopReason = 'Raffle does not use funds escrow'
    return out
  }

  const status = String(raffle.status || '').toLowerCase()
  const refundPolicy = String(
    (raffle as { cancellation_refund_policy?: string | null }).cancellation_refund_policy || ''
  ).toLowerCase()
  const allowsRefund =
    status === 'failed_refund_available' ||
    status === 'pending_min_not_met' ||
    (status === 'cancelled' && refundPolicy !== 'no_refund')
  if (!allowsRefund) {
    out.skipped = 1
    out.stopReason = `Raffle status ${status} does not allow auto-refund`
    return out
  }

  const { data: rows, error } = await getSupabaseAdmin()
    .from('entries')
    .select(
      'id, raffle_id, wallet_address, amount_paid, currency, status, refunded_at, referral_complimentary, transaction_signature'
    )
    .eq('raffle_id', params.raffleId)
    .eq('status', 'confirmed')
    .is('refunded_at', null)
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error) {
    out.stoppedEarly = true
    out.stopReason = error.message
    return out
  }

  for (const row of rows ?? []) {
    const entry = row as Entry
    out.attempted += 1
    const result = await refundOneEntry({ raffle, entry, source: params.source })
    if (result.ok) {
      out.refunded += 1
      continue
    }
    out.failed += 1
    out.errors.push({ entryId: entry.id, error: result.error })
    if (result.coverage) {
      out.stoppedEarly = true
      out.stopReason = result.error
      break
    }
  }

  return out
}

/** Cron sweep: oldest unrefunded escrow entries across failed/cancelled raffles. */
export async function autoRefundTicketEntriesSweep(params?: {
  limit?: number
  source?: Extract<TicketRefundLedgerSource, 'auto_finalize' | 'auto_cron'>
}): Promise<AutoTicketRefundResult & { raffleIds: string[] }> {
  const limit = Math.max(1, Math.min(params?.limit ?? 30, 80))
  const source = params?.source ?? 'auto_cron'
  const out: AutoTicketRefundResult & { raffleIds: string[] } = {
    attempted: 0,
    refunded: 0,
    skipped: 0,
    failed: 0,
    stoppedEarly: false,
    stopReason: null,
    errors: [],
    raffleIds: [],
  }

  const { data: refundRaffles, error: raffleErr } = await getSupabaseAdmin()
    .from('raffles')
    .select('id, status, cancellation_refund_policy, ticket_payments_to_funds_escrow')
    .eq('ticket_payments_to_funds_escrow', true)
    .in('status', ['failed_refund_available', 'cancelled'])
    .limit(500)

  if (raffleErr) {
    out.stoppedEarly = true
    out.stopReason = raffleErr.message
    return out
  }

  const eligibleIds = (refundRaffles ?? [])
    .filter((r) => {
      const status = String(r.status || '').toLowerCase()
      if (status === 'failed_refund_available') return true
      const policy = String(r.cancellation_refund_policy || '').toLowerCase()
      return status === 'cancelled' && policy !== 'no_refund'
    })
    .map((r) => String(r.id))
    .filter(Boolean)

  if (eligibleIds.length === 0) return out

  const chunkSize = 100
  const candidates: Entry[] = []
  for (let i = 0; i < eligibleIds.length && candidates.length < limit; i += chunkSize) {
    const chunk = eligibleIds.slice(i, i + chunkSize)
    const { data: entries, error } = await getSupabaseAdmin()
      .from('entries')
      .select(
        'id, raffle_id, wallet_address, amount_paid, currency, status, refunded_at, referral_complimentary, transaction_signature, created_at'
      )
      .in('raffle_id', chunk)
      .eq('status', 'confirmed')
      .is('refunded_at', null)
      .order('created_at', { ascending: true })
      .limit(limit - candidates.length)
    if (error) {
      out.stoppedEarly = true
      out.stopReason = error.message
      return out
    }
    for (const e of entries ?? []) candidates.push(e as Entry)
  }

  const raffleCache = new Map<string, Raffle>()
  const touched = new Set<string>()

  for (const entry of candidates.slice(0, limit)) {
    out.attempted += 1
    let raffle = raffleCache.get(entry.raffle_id)
    if (!raffle) {
      const loaded = await getRaffleById(entry.raffle_id)
      if (!loaded || !raffleUsesFundsEscrow(loaded)) {
        out.skipped += 1
        continue
      }
      raffle = loaded
      raffleCache.set(entry.raffle_id, loaded)
    }

    const result = await refundOneEntry({ raffle, entry, source })
    if (result.ok) {
      out.refunded += 1
      touched.add(entry.raffle_id)
      continue
    }
    out.failed += 1
    out.errors.push({ entryId: entry.id, error: result.error })
    if (result.coverage) {
      out.stoppedEarly = true
      out.stopReason = result.error
      break
    }
  }

  out.raffleIds = Array.from(touched)
  return out
}
