import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { getRaffleById, updateRaffle } from '@/lib/db/raffles'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getRaffleTreasuryWalletAddress } from '@/lib/solana/raffle-treasury-wallet'
import { getCancellationFeeSol } from '@/lib/config/raffles'
import { verifyCancellationFeeTransaction } from '@/lib/verify-cancellation-fee-tx'
import { raffleRequiresCancellationFee } from '@/lib/raffles/cancellation-fee-policy'

export const dynamic = 'force-dynamic'

async function isFeeTxUsedElsewhere(signature: string, excludeRaffleId: string): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin()
    .from('raffles')
    .select('id')
    .eq('cancellation_fee_payment_tx', signature.trim())
    .neq('id', excludeRaffleId)
    .limit(1)
    .maybeSingle()
  if (error) return true
  return !!data
}

/**
 * POST /api/raffles/[id]/pay-cancellation-fee
 * If a raffle was cancelled (including legacy admin accepts) and the start time had already passed, the
 * creator may still need to pay the SOL fee to unlock "claim prize back" and align with policy.
 * For live / ready-to-draw raffles, a verified fee is also treated as a cancellation request so admins see it.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<Record<string, string | string[] | undefined>> }
) {
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const params = await context.params
    const id = params.id
    if (typeof id !== 'string') {
      return NextResponse.json({ error: 'Invalid raffle id' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const raw =
      typeof (body as { feeTransactionSignature?: unknown }).feeTransactionSignature === 'string'
        ? (body as { feeTransactionSignature: string }).feeTransactionSignature.trim()
        : ''
    if (!raw) {
      return NextResponse.json({ error: 'feeTransactionSignature is required' }, { status: 400 })
    }

    const raffle = await getRaffleById(id)
    if (!raffle) {
      return NextResponse.json({ error: 'Raffle not found' }, { status: 404 })
    }

    const creator = (raffle.creator_wallet || raffle.created_by || '').trim()
    const wallet = session.wallet.trim()
    if (creator !== wallet) {
      return NextResponse.json({ error: 'Only the raffle creator can pay this fee' }, { status: 403 })
    }

    if (!raffleRequiresCancellationFee(raffle, new Date())) {
      return NextResponse.json(
        { error: 'A cancellation fee is not required for this raffle (it had not started by schedule).' },
        { status: 400 }
      )
    }

    const status = (raffle.status ?? '').toLowerCase()
    const isOpenCancellationStatus = status === 'live' || status === 'ready_to_draw'

    if (raffle.cancellation_fee_paid_at) {
      if (!raffle.cancellation_requested_at && isOpenCancellationStatus) {
        await updateRaffle(id, {
          cancellation_requested_at: raffle.cancellation_fee_paid_at,
        })
        return NextResponse.json({ success: true, alreadyPaid: true, cancellationRequested: true })
      }
      return NextResponse.json({ success: true, alreadyPaid: true })
    }

    const treasury = getRaffleTreasuryWalletAddress()
    if (!treasury) {
      return NextResponse.json(
        { error: 'Treasury wallet is not configured. Set RAFFLE_RECIPIENT_WALLET.' },
        { status: 500 }
      )
    }

    if (await isFeeTxUsedElsewhere(raw, id)) {
      return NextResponse.json(
        { error: 'This transaction was already used for a cancellation fee.' },
        { status: 400 }
      )
    }

    const v = await verifyCancellationFeeTransaction(raw, wallet, treasury)
    if (!v.valid) {
      return NextResponse.json(
        {
          error: v.error ?? 'Could not verify transaction.',
          feeSol: getCancellationFeeSol(),
          treasury,
        },
        { status: 400 }
      )
    }

    const nowIso = new Date().toISOString()
    const shouldOpenCancellationRequest =
      !raffle.cancellation_requested_at && isOpenCancellationStatus
    const patch: Parameters<typeof updateRaffle>[1] = {
      cancellation_fee_paid_at: nowIso,
      cancellation_fee_payment_tx: raw,
    }
    if (shouldOpenCancellationRequest) {
      patch.cancellation_requested_at = nowIso
    }
    await updateRaffle(id, patch)

    return NextResponse.json({ success: true, cancellationRequested: shouldOpenCancellationRequest })
  } catch (e) {
    console.error('[pay-cancellation-fee]', e)
    return NextResponse.json({ error: 'Failed to record payment' }, { status: 500 })
  }
}
