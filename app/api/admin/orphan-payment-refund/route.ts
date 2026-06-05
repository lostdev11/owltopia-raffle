import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { safeErrorMessage } from '@/lib/safe-error'
import { adminOrphanPaymentRefundBody, parseOr400 } from '@/lib/validations'
import { rateLimit, getClientIp } from '@/lib/rate-limit'
import { getRaffleBySlug, getEntriesByRaffleId } from '@/lib/db/raffles'
import {
  acquireEntryRefundLock,
  clearEntryRefundLock,
  getEntryById,
  markEntryRefunded,
} from '@/lib/db/entries'
import { getPaymentTransactionDetails } from '@/lib/raffles/payment-transaction-details'
import { refundEntryFromFundsEscrow } from '@/lib/raffles/funds-escrow'
import { raffleUsesFundsEscrow } from '@/lib/raffles/ticket-escrow-policy'
import { walletsEqualSolana } from '@/lib/solana/normalize-wallet'
import type { Entry } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/orphan-payment-refund
 * Refund a ticket payment that reached funds escrow but never confirmed in-app (e.g. orphaned pending/rejected row).
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const ip = getClientIp(request)
    const rl = rateLimit(`orphan-payment-refund:${ip}:${session.wallet}`, 30, 60_000)
    if (!rl.allowed) {
      return NextResponse.json({ ok: false, error: 'rate limited' }, { status: 429 })
    }

    const body = await request.json().catch(() => ({}))
    const parsed = parseOr400(adminOrphanPaymentRefundBody, body)
    if (!parsed.ok) {
      return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 })
    }

    const { transactionSignature, walletAddress, raffleSlug, entryId } = parsed.data

    const raffle = await getRaffleBySlug(raffleSlug.trim())
    if (!raffle) {
      return NextResponse.json({ ok: false, error: 'Raffle not found' }, { status: 404 })
    }

    if (!raffleUsesFundsEscrow(raffle)) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'This raffle does not use funds escrow. Send a manual treasury refund and record the payout separately.',
        },
        { status: 400 }
      )
    }

    const txResult = await getPaymentTransactionDetails(transactionSignature, { raffle })
    if (!txResult.ok) {
      return NextResponse.json(
        {
          ok: false,
          error:
            txResult.reason === 'NOT_FOUND'
              ? 'Transaction not found on Solana'
              : 'Could not parse payment from transaction',
          detail: txResult.detail,
        },
        { status: 404 }
      )
    }

    const { walletAddress: payer, amount, currency } = txResult.data
    if (!walletsEqualSolana(payer, walletAddress)) {
      return NextResponse.json(
        { ok: false, error: 'Transaction fee payer does not match the provided wallet' },
        { status: 400 }
      )
    }

    let entry: Entry | null = null
    if (entryId) {
      const row = await getEntryById(entryId)
      if (!row || row.raffle_id !== raffle.id) {
        return NextResponse.json({ ok: false, error: 'Entry not found for this raffle' }, { status: 404 })
      }
      entry = row
    } else {
      const tolerance = 0.001
      const candidates = (await getEntriesByRaffleId(raffle.id)).filter(
        e =>
          walletsEqualSolana(e.wallet_address, walletAddress) &&
          !e.refunded_at &&
          (e.status === 'pending' || e.status === 'rejected' || e.status === 'confirmed') &&
          String(e.currency || '').toUpperCase() === currency &&
          Math.abs(Number(e.amount_paid) - amount) <= tolerance
      )
      if (candidates.length === 1) {
        entry = candidates[0]!
      } else if (candidates.length > 1) {
        return NextResponse.json(
          {
            ok: false,
            error: 'Multiple matching entries — pass entryId in the request body',
            entryIds: candidates.map(c => c.id),
          },
          { status: 400 }
        )
      }
    }

    const refundEntry: Entry = entry ?? {
      id: 'orphan',
      raffle_id: raffle.id,
      wallet_address: walletAddress,
      ticket_quantity: 0,
      transaction_signature: transactionSignature,
      status: 'pending',
      amount_paid: amount,
      currency,
      created_at: new Date().toISOString(),
      verified_at: null,
      restored_at: null,
      restored_by: null,
      refunded_at: null,
      refund_transaction_signature: null,
      referral_complimentary: false,
    }

    if (entry?.refunded_at) {
      return NextResponse.json({
        ok: true,
        alreadyRefunded: true,
        transactionSignature: entry.refund_transaction_signature,
        entryId: entry.id,
      })
    }

    if (entry) {
      const { acquired } = await acquireEntryRefundLock(entry.id)
      if (!acquired) {
        return NextResponse.json(
          { ok: false, error: 'Refund already in progress for this entry; retry shortly' },
          { status: 409 }
        )
      }

      try {
        const result = await refundEntryFromFundsEscrow(raffle, refundEntry)
        if (!result.ok) {
          await clearEntryRefundLock(entry.id)
          return NextResponse.json(
            { ok: false, error: 'error' in result ? result.error : 'Refund failed' },
            { status: 500 }
          )
        }
        if (!result.signature) {
          await clearEntryRefundLock(entry.id)
          return NextResponse.json({ ok: false, error: 'Refund failed' }, { status: 500 })
        }

        await markEntryRefunded(entry.id, result.signature)
        return NextResponse.json({
          ok: true,
          entryId: entry.id,
          amount,
          currency,
          refundTransactionSignature: result.signature,
          walletAddress,
        })
      } catch (e) {
        await clearEntryRefundLock(entry.id)
        throw e
      }
    }

    const result = await refundEntryFromFundsEscrow(raffle, refundEntry)
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: 'error' in result ? result.error : 'Refund failed' },
        { status: 500 }
      )
    }
    if (!result.signature) {
      return NextResponse.json({ ok: false, error: 'Refund failed' }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      amount,
      currency,
      refundTransactionSignature: result.signature,
      walletAddress,
      note: 'No entry row matched; refund sent from escrow without updating entries',
    })
  } catch (error) {
    console.error('[admin/orphan-payment-refund]', error)
    return NextResponse.json({ ok: false, error: safeErrorMessage(error) }, { status: 500 })
  }
}
