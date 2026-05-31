import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { safeErrorMessage } from '@/lib/safe-error'
import { adminRecordOrphanRefundBody, parseOr400 } from '@/lib/validations'
import { rateLimit, getClientIp } from '@/lib/rate-limit'
import { getEntryById, markOrphanEntryRefundedManual } from '@/lib/db/entries'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/record-orphan-refund
 * Full admin: paste refund TX after sending SOL/USDC from your own wallet to the buyer.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const ip = getClientIp(request)
    const rl = rateLimit(`record-orphan-refund:${ip}:${session.wallet}`, 40, 60_000)
    if (!rl.allowed) {
      return NextResponse.json({ ok: false, error: 'rate limited' }, { status: 429 })
    }

    const body = await request.json().catch(() => ({}))
    const parsed = parseOr400(adminRecordOrphanRefundBody, body)
    if (!parsed.ok) {
      return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 })
    }

    const { entryId, refundTransactionSignature } = parsed.data
    const entry = await getEntryById(entryId)
    if (!entry) {
      return NextResponse.json({ ok: false, error: 'Entry not found' }, { status: 404 })
    }

    if (entry.refunded_at) {
      return NextResponse.json({
        ok: true,
        alreadyRefunded: true,
        entryId: entry.id,
        refundTransactionSignature: entry.refund_transaction_signature,
      })
    }

    const { updated } = await markOrphanEntryRefundedManual(entryId, refundTransactionSignature)
    if (!updated) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'Entry was not updated. It may already be refunded or have a status that cannot be recorded.',
        },
        { status: 400 }
      )
    }

    return NextResponse.json({
      ok: true,
      entryId,
      refundTransactionSignature: refundTransactionSignature.trim(),
      walletAddress: entry.wallet_address,
      amountPaid: entry.amount_paid,
      currency: entry.currency,
      ticketQuantity: entry.ticket_quantity,
    })
  } catch (error) {
    console.error('[admin/record-orphan-refund]', error)
    return NextResponse.json({ ok: false, error: safeErrorMessage(error) }, { status: 500 })
  }
}
