/**
 * Funds-escrow ticket refund ledger — durable history for buyers + admin.
 */
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export const TICKET_REFUND_LEDGER_SOURCES = [
  'buyer_claim',
  'admin_send',
  'auto_finalize',
  'auto_cron',
  'manual_record',
  'zero_payment',
  'legacy_backfill',
] as const

export type TicketRefundLedgerSource = (typeof TICKET_REFUND_LEDGER_SOURCES)[number]

export type TicketRefundLedgerRow = {
  id: string
  entry_id: string
  raffle_id: string
  wallet_address: string
  amount: number
  currency: string
  tx_signature: string
  refunded_at: string
  source: TicketRefundLedgerSource
  actor_wallet: string | null
  created_at: string
  raffle_title?: string | null
  raffle_slug?: string | null
}

export type RecordTicketRefundLedgerParams = {
  entryId: string
  raffleId: string
  walletAddress: string
  amount: number
  currency: string
  txSignature: string
  refundedAt?: string
  source: TicketRefundLedgerSource
  actorWallet?: string | null
}

/** Idempotent on entry_id — safe to call after markEntryRefunded / manual record. */
export async function recordTicketRefundLedger(
  params: RecordTicketRefundLedgerParams
): Promise<{ inserted: boolean }> {
  const entryId = params.entryId.trim()
  const raffleId = params.raffleId.trim()
  const wallet = params.walletAddress.trim()
  const sig = params.txSignature.trim()
  if (!entryId || !raffleId || !wallet || !sig) {
    return { inserted: false }
  }

  const amount = Number(params.amount)
  const currency = (params.currency || 'SOL').trim().toUpperCase() || 'SOL'
  const refundedAt = params.refundedAt?.trim() || new Date().toISOString()
  const actor = params.actorWallet?.trim() || null

  const { error } = await getSupabaseAdmin()
    .from('funds_escrow_ticket_refunds')
    .upsert(
      {
        entry_id: entryId,
        raffle_id: raffleId,
        wallet_address: wallet,
        amount: Number.isFinite(amount) ? amount : 0,
        currency,
        tx_signature: sig,
        refunded_at: refundedAt,
        source: params.source,
        actor_wallet: actor,
      },
      { onConflict: 'entry_id', ignoreDuplicates: true }
    )

  if (error) {
    // Unique race: another writer inserted first — treat as success.
    if (String(error.code) === '23505' || /duplicate|unique/i.test(error.message || '')) {
      return { inserted: false }
    }
    console.error('[ticket-refund-ledger] record failed:', error)
    throw new Error(`Failed to record ticket refund ledger: ${error.message}`)
  }
  return { inserted: true }
}

export async function listTicketRefundLedgerByWallet(
  wallet: string,
  limit = 40
): Promise<TicketRefundLedgerRow[]> {
  const capped = Math.max(1, Math.min(limit, 100))
  const { data, error } = await getSupabaseAdmin()
    .from('funds_escrow_ticket_refunds')
    .select(
      'id, entry_id, raffle_id, wallet_address, amount, currency, tx_signature, refunded_at, source, actor_wallet, created_at, raffles:raffle_id(title, slug)'
    )
    .eq('wallet_address', wallet.trim())
    .order('refunded_at', { ascending: false })
    .limit(capped)

  if (error) throw new Error(error.message)

  return (data ?? []).map((row) => {
    const raffle = row.raffles as { title?: string; slug?: string } | null
    return {
      id: String(row.id),
      entry_id: String(row.entry_id),
      raffle_id: String(row.raffle_id),
      wallet_address: String(row.wallet_address),
      amount: Number(row.amount) || 0,
      currency: String(row.currency || 'SOL'),
      tx_signature: String(row.tx_signature || ''),
      refunded_at: String(row.refunded_at),
      source: row.source as TicketRefundLedgerSource,
      actor_wallet: row.actor_wallet != null ? String(row.actor_wallet) : null,
      created_at: String(row.created_at),
      raffle_title: raffle?.title ?? null,
      raffle_slug: raffle?.slug ?? null,
    }
  })
}

export async function listTicketRefundLedgerAdmin(params: {
  wallet?: string
  raffleId?: string
  limit?: number
}): Promise<TicketRefundLedgerRow[]> {
  const capped = Math.max(1, Math.min(params.limit ?? 50, 200))
  let q = getSupabaseAdmin()
    .from('funds_escrow_ticket_refunds')
    .select(
      'id, entry_id, raffle_id, wallet_address, amount, currency, tx_signature, refunded_at, source, actor_wallet, created_at, raffles:raffle_id(title, slug)'
    )
    .order('refunded_at', { ascending: false })
    .limit(capped)

  if (params.wallet?.trim()) q = q.eq('wallet_address', params.wallet.trim())
  if (params.raffleId?.trim()) q = q.eq('raffle_id', params.raffleId.trim())

  const { data, error } = await q
  if (error) throw new Error(error.message)

  return (data ?? []).map((row) => {
    const raffle = row.raffles as { title?: string; slug?: string } | null
    return {
      id: String(row.id),
      entry_id: String(row.entry_id),
      raffle_id: String(row.raffle_id),
      wallet_address: String(row.wallet_address),
      amount: Number(row.amount) || 0,
      currency: String(row.currency || 'SOL'),
      tx_signature: String(row.tx_signature || ''),
      refunded_at: String(row.refunded_at),
      source: row.source as TicketRefundLedgerSource,
      actor_wallet: row.actor_wallet != null ? String(row.actor_wallet) : null,
      created_at: String(row.created_at),
      raffle_title: raffle?.title ?? null,
      raffle_slug: raffle?.slug ?? null,
    }
  })
}

export function ticketRefundSourceLabel(source: TicketRefundLedgerSource): string {
  switch (source) {
    case 'buyer_claim':
      return 'Claimed'
    case 'admin_send':
      return 'Admin'
    case 'auto_finalize':
    case 'auto_cron':
      return 'Auto'
    case 'manual_record':
      return 'Recorded'
    case 'zero_payment':
      return 'No payment'
    case 'legacy_backfill':
      return 'Prior'
    default:
      return source
  }
}
