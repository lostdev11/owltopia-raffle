import { NextRequest, NextResponse } from 'next/server'
import { getRaffleById } from '@/lib/db/raffles'
import {
  acquireEntryRefundLock,
  clearEntryRefundLock,
  getEntryById,
  markEntryRefunded,
} from '@/lib/db/entries'
import { requireSession } from '@/lib/auth-server'
import { safeErrorMessage } from '@/lib/safe-error'
import { claimRefundEntryBody, parseOr400 } from '@/lib/validations'
import { raffleUsesFundsEscrow } from '@/lib/raffles/ticket-escrow-policy'
import { refundEntryFromFundsEscrow } from '@/lib/raffles/funds-escrow'
import { rateLimit, getClientIp } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const ERROR_BODY = { success: false as const, error: 'server error' }

/**
 * POST /api/entries/claim-refund
 * Buyer refunds ticket payment from funds escrow when raffle failed after extension (min not met).
 */
export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request)
    const rl = rateLimit(`claim-refund:${ip}`, 20, 60_000)
    if (!rl.allowed) {
      return NextResponse.json(ERROR_BODY, { status: 429, headers: { 'Retry-After': '60' } })
    }

    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const body = await request.json().catch(() => ({}))
    const parsed = parseOr400(claimRefundEntryBody, body)
    if (!parsed.ok) {
      return NextResponse.json(ERROR_BODY, { status: 400 })
    }

    const entry = await getEntryById(parsed.data.entryId)
    if (!entry) {
      return NextResponse.json(ERROR_BODY, { status: 404 })
    }

    if (entry.wallet_address.trim() !== session.wallet.trim()) {
      return NextResponse.json(ERROR_BODY, { status: 403 })
    }

    const raffle = await getRaffleById(entry.raffle_id)
    if (!raffle) {
      return NextResponse.json(ERROR_BODY, { status: 404 })
    }

    if (raffle.status !== 'failed_refund_available') {
      return NextResponse.json(ERROR_BODY, { status: 400 })
    }

    if (!raffleUsesFundsEscrow(raffle)) {
      return NextResponse.json(ERROR_BODY, { status: 400 })
    }

    if (entry.status !== 'confirmed') {
      return NextResponse.json(ERROR_BODY, { status: 400 })
    }

    if (entry.refunded_at) {
      return NextResponse.json({
        success: true,
        alreadyRefunded: true,
        transactionSignature: entry.refund_transaction_signature,
      })
    }

    const { acquired } = await acquireEntryRefundLock(entry.id)
    if (!acquired) {
      return NextResponse.json(ERROR_BODY, { status: 423, headers: { 'Retry-After': '10' } })
    }

    try {
      const result = await refundEntryFromFundsEscrow(raffle, entry)
      if (!result.ok || !result.signature) {
        await clearEntryRefundLock(entry.id)
        return NextResponse.json(ERROR_BODY, { status: 400 })
      }

      await markEntryRefunded(entry.id, result.signature)

      return NextResponse.json({
        success: true,
        transactionSignature: result.signature,
      })
    } catch (e) {
      await clearEntryRefundLock(entry.id)
      throw e
    }
  } catch (error) {
    console.error('[claim-refund]', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
