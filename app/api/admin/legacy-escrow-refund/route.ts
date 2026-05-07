import { NextRequest, NextResponse } from 'next/server'
import { getRaffleById } from '@/lib/db/raffles'
import {
  acquireEntryRefundLock,
  clearEntryRefundLock,
  getEntryById,
  markEntryRefunded,
} from '@/lib/db/entries'
import { requireFullAdminSession } from '@/lib/auth-server'
import { safeErrorMessage } from '@/lib/safe-error'
import { adminLegacyEscrowRefundBody, parseOr400 } from '@/lib/validations'
import { refundEntryFromFundsEscrow } from '@/lib/raffles/funds-escrow'
import {
  raffleAllowsAdminFundsEscrowRefund,
  raffleUsesFundsEscrow,
} from '@/lib/raffles/ticket-escrow-policy'
import { rateLimit, getClientIp } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

type LegacyRefundRow =
  | {
      entryId: string
      ok: true
      transactionSignature: string
      alreadyRefunded?: boolean
    }
  | { entryId: string; ok: false; error: string }

/**
 * POST /api/admin/legacy-escrow-refund
 * Full admin only. For each entry in a refund-eligible, funds-escrow raffle: sends gross from FUNDS_ESCROW
 * (same on-chain path as buyer self-claim).
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const ip = getClientIp(request)
    const rl = rateLimit(`legacy-escrow-refund:${ip}:${session.wallet}`, 120, 60_000)
    if (!rl.allowed) {
      return NextResponse.json(
        { ok: false as const, error: 'rate limited', results: [] as LegacyRefundRow[] },
        { status: 429, headers: { 'Retry-After': '60' } }
      )
    }

    const body = await request.json().catch(() => ({}))
    const parsed = parseOr400(adminLegacyEscrowRefundBody, body)
    if (!parsed.ok) {
      return NextResponse.json(
        { ok: false as const, error: parsed.error, results: [] as LegacyRefundRow[] },
        { status: 400 }
      )
    }

    const { entryIds } = parsed.data
    const results: LegacyRefundRow[] = []

    for (const entryId of entryIds) {
      const entry = await getEntryById(entryId)
      if (!entry) {
        results.push({ entryId, ok: false, error: 'Entry not found' })
        continue
      }

      const raffle = await getRaffleById(entry.raffle_id)
      if (!raffle) {
        results.push({ entryId, ok: false, error: 'Raffle not found' })
        continue
      }

      if (!raffleAllowsAdminFundsEscrowRefund(raffle)) {
        const statusErr = !raffleUsesFundsEscrow(raffle)
          ? 'This raffle does not use funds escrow for ticket payments; send from treasury (or host wallet) and record the payout tx manually.'
          : `Admin escrow refunds need status cancelled, pending_min_not_met, or failed_refund_available — a pending creator cancellation request — or live/ready_to_draw with the escrow prize return recorded (prize_returned_at / prize_return_tx). Current status: ${raffle.status ?? 'unknown'}.`
        results.push({
          entryId,
          ok: false,
          error: statusErr,
        })
        continue
      }

      if (entry.status !== 'confirmed') {
        results.push({ entryId, ok: false, error: 'Entry is not confirmed' })
        continue
      }

      if (entry.refunded_at) {
        results.push({
          entryId,
          ok: true,
          transactionSignature: (entry.refund_transaction_signature ?? '').trim(),
          alreadyRefunded: true,
        })
        continue
      }

      const { acquired } = await acquireEntryRefundLock(entry.id)
      if (!acquired) {
        results.push({
          entryId,
          ok: false,
          error: 'Could not acquire refund lock (in progress or stale lock; retry shortly)',
        })
        continue
      }

      try {
        const result = await refundEntryFromFundsEscrow(raffle, entry)
        if (!result.ok) {
          await clearEntryRefundLock(entry.id)
          results.push({ entryId, ok: false, error: result.error })
          continue
        }

        await markEntryRefunded(entry.id, result.signature)
        results.push({ entryId, ok: true, transactionSignature: result.signature })
      } catch (e) {
        await clearEntryRefundLock(entry.id)
        results.push({
          entryId,
          ok: false,
          error: safeErrorMessage(e),
        })
      }
    }

    const okCount = results.filter((r) => r.ok).length
    return NextResponse.json({
      ok: okCount === results.length,
      results,
      okCount,
      requestedCount: entryIds.length,
    })
  } catch (error) {
    console.error('[admin/legacy-escrow-refund]', error)
    return NextResponse.json(
      { ok: false as const, error: safeErrorMessage(error), results: [] as LegacyRefundRow[] },
      { status: 500 }
    )
  }
}
