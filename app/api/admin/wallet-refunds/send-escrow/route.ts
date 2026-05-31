import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { safeErrorMessage } from '@/lib/safe-error'
import { adminSendWalletEscrowRefundsBody, parseOr400 } from '@/lib/validations'
import { rateLimit, getClientIp } from '@/lib/rate-limit'
import { getEntryById, acquireEntryRefundLock, clearEntryRefundLock, markEntryRefunded } from '@/lib/db/entries'
import { getRaffleById } from '@/lib/db/raffles'
import { getBuyoutOfferById, finalizeBuyoutRefund, getRefundEligibleOffer } from '@/lib/db/buyout-offers'
import { refundEntryFromFundsEscrow, refundBuyoutOfferFromFundsEscrow } from '@/lib/raffles/funds-escrow'
import { raffleAllowsAdminFundsEscrowRefund } from '@/lib/raffles/ticket-escrow-policy'
import { resolveBuyoutDepositSource } from '@/lib/buyout/deposit-source'
import { walletsEqualSolana } from '@/lib/solana/normalize-wallet'

export const dynamic = 'force-dynamic'

type RefundRow =
  | { id: string; kind: 'ticket' | 'buyout'; ok: true; transactionSignature: string; alreadyRefunded?: boolean }
  | { id: string; kind: 'ticket' | 'buyout'; ok: false; error: string }

/**
 * POST /api/admin/wallet-refunds/send-escrow
 * Full admin: send selected (or all) ticket + buyout refunds from FUNDS_ESCROW for one wallet.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const ip = getClientIp(request)
    const rl = rateLimit(`wallet-refund-send:${ip}:${session.wallet}`, 40, 60_000)
    if (!rl.allowed) {
      return NextResponse.json({ ok: false, error: 'rate limited', results: [] as RefundRow[] }, { status: 429 })
    }

    const body = await request.json().catch(() => ({}))
    const parsed = parseOr400(adminSendWalletEscrowRefundsBody, body)
    if (!parsed.ok) {
      return NextResponse.json({ ok: false, error: parsed.error, results: [] as RefundRow[] }, { status: 400 })
    }

    const { wallet, entryIds, buyoutOfferIds } = parsed.data
    const results: RefundRow[] = []

    for (const entryId of entryIds) {
      const entry = await getEntryById(entryId)
      if (!entry) {
        results.push({ id: entryId, kind: 'ticket', ok: false, error: 'Entry not found' })
        continue
      }
      if (!walletsEqualSolana(entry.wallet_address, wallet)) {
        results.push({ id: entryId, kind: 'ticket', ok: false, error: 'Entry wallet does not match lookup wallet' })
        continue
      }

      const raffle = await getRaffleById(entry.raffle_id)
      if (!raffle) {
        results.push({ id: entryId, kind: 'ticket', ok: false, error: 'Raffle not found' })
        continue
      }
      if (!raffleAllowsAdminFundsEscrowRefund(raffle)) {
        results.push({
          id: entryId,
          kind: 'ticket',
          ok: false,
          error: 'Raffle is not eligible for admin funds-escrow refund',
        })
        continue
      }
      if (entry.status !== 'confirmed') {
        results.push({ id: entryId, kind: 'ticket', ok: false, error: 'Entry is not confirmed' })
        continue
      }
      if (entry.refunded_at) {
        results.push({
          id: entryId,
          kind: 'ticket',
          ok: true,
          transactionSignature: (entry.refund_transaction_signature ?? '').trim(),
          alreadyRefunded: true,
        })
        continue
      }

      const { acquired } = await acquireEntryRefundLock(entry.id)
      if (!acquired) {
        results.push({ id: entryId, kind: 'ticket', ok: false, error: 'Refund in progress — retry shortly' })
        continue
      }

      try {
        const result = await refundEntryFromFundsEscrow(raffle, entry)
        if (!result.ok) {
          await clearEntryRefundLock(entry.id)
          results.push({
            id: entryId,
            kind: 'ticket',
            ok: false,
            error: 'error' in result ? result.error : 'Escrow refund failed',
          })
          continue
        }
        if (!result.signature) {
          await clearEntryRefundLock(entry.id)
          results.push({ id: entryId, kind: 'ticket', ok: false, error: 'Escrow refund failed' })
          continue
        }
        await markEntryRefunded(entry.id, result.signature)
        results.push({ id: entryId, kind: 'ticket', ok: true, transactionSignature: result.signature })
      } catch (e) {
        await clearEntryRefundLock(entry.id)
        results.push({ id: entryId, kind: 'ticket', ok: false, error: safeErrorMessage(e) })
      }
    }

    for (const offerId of buyoutOfferIds) {
      const offer = await getRefundEligibleOffer(offerId)
      if (!offer) {
        const existing = await getBuyoutOfferById(offerId)
        if (existing?.refunded_at) {
          results.push({
            id: offerId,
            kind: 'buyout',
            ok: true,
            transactionSignature: (existing.refund_tx_signature ?? '').trim(),
            alreadyRefunded: true,
          })
        } else {
          results.push({ id: offerId, kind: 'buyout', ok: false, error: 'Offer not eligible for refund' })
        }
        continue
      }
      if (!walletsEqualSolana(offer.bidder_wallet, wallet)) {
        results.push({ id: offerId, kind: 'buyout', ok: false, error: 'Offer bidder does not match lookup wallet' })
        continue
      }

      const source = await resolveBuyoutDepositSource(offer)
      if (source !== 'funds_escrow') {
        results.push({
          id: offerId,
          kind: 'buyout',
          ok: false,
          error:
            source === 'treasury'
              ? 'Bid is in fee treasury — send manually and record the refund tx'
              : 'Could not verify buyout deposit source',
        })
        continue
      }

      const payout = await refundBuyoutOfferFromFundsEscrow(offer)
      if (!payout.ok) {
        results.push({
          id: offerId,
          kind: 'buyout',
          ok: false,
          error: 'error' in payout ? payout.error : 'Escrow refund failed',
        })
        continue
      }
      if (!payout.signature) {
        results.push({ id: offerId, kind: 'buyout', ok: false, error: 'Escrow refund failed' })
        continue
      }

      const saved = await finalizeBuyoutRefund({ offerId: offer.id, refundTxSignature: payout.signature })
      if (!saved) {
        results.push({
          id: offerId,
          kind: 'buyout',
          ok: false,
          error: `Refund tx sent (${payout.signature}) but database update failed`,
        })
        continue
      }

      results.push({ id: offerId, kind: 'buyout', ok: true, transactionSignature: payout.signature })
    }

    const okCount = results.filter((r) => r.ok).length
    return NextResponse.json({
      ok: okCount === results.length,
      okCount,
      requestedCount: entryIds.length + buyoutOfferIds.length,
      results,
    })
  } catch (error) {
    console.error('[admin/wallet-refunds/send-escrow]', error)
    return NextResponse.json(
      { ok: false, error: safeErrorMessage(error), results: [] as RefundRow[] },
      { status: 500 },
    )
  }
}
