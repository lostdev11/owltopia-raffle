import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { getRaffleById, updateRaffle } from '@/lib/db/raffles'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getCancellationFeeSol } from '@/lib/config/raffles'
import { getRaffleTreasuryWalletAddress } from '@/lib/solana/raffle-treasury-wallet'
import { raffleRequiresCancellationFee } from '@/lib/raffles/cancellation-fee-policy'
import { verifyCancellationFeeTransaction } from '@/lib/verify-cancellation-fee-tx'

export const dynamic = 'force-dynamic'

async function isCancellationFeeTxUsedElsewhere(signature: string, excludeRaffleId: string): Promise<boolean> {
  const sig = signature.trim()
  if (!sig) return false
  const { data, error } = await getSupabaseAdmin()
    .from('raffles')
    .select('id')
    .eq('cancellation_fee_payment_tx', sig)
    .neq('id', excludeRaffleId)
    .limit(1)
    .maybeSingle()
  if (error) {
    console.error('[request-cancellation] duplicate tx check', error)
    return true
  }
  return !!data
}

/**
 * POST /api/raffles/[id]/request-cancellation
 * Creator requests cancellation. If the raffle has already started (start_time in the past), the creator
 * must include a verified on-chain SOL transfer of the cancellation fee to treasury. Admin then accepts
 * in Owl Vision. Ticket buyers with funds-escrow sales can claim refunds from the dashboard.
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
    const rawSig =
      typeof (body as { feeTransactionSignature?: unknown }).feeTransactionSignature === 'string'
        ? (body as { feeTransactionSignature: string }).feeTransactionSignature.trim()
        : ''
    const feeTransactionSignature = rawSig.length > 0 ? rawSig : null

    const raffle = await getRaffleById(id)
    if (!raffle) {
      return NextResponse.json({ error: 'Raffle not found' }, { status: 404 })
    }

    const creatorWallet = (raffle.creator_wallet || raffle.created_by || '').trim()
    const wallet = session.wallet.trim()
    if (creatorWallet !== wallet) {
      return NextResponse.json(
        { error: 'Only the raffle creator can request cancellation' },
        { status: 403 }
      )
    }

    const status = (raffle.status ?? '').toLowerCase()
    if (status !== 'live' && status !== 'ready_to_draw') {
      return NextResponse.json(
        { error: 'Only live or ready-to-draw raffles can be cancelled' },
        { status: 400 }
      )
    }

    const needsFee = raffleRequiresCancellationFee(raffle, new Date())
    const treasury = getRaffleTreasuryWalletAddress()
    const feeSol = getCancellationFeeSol()

    const alreadyRequested = !!raffle.cancellation_requested_at
    const feePaid = !!raffle.cancellation_fee_paid_at

    // Pay fee only (e.g. legacy request before fee was required, or retry after failed confirm)
    if (alreadyRequested && needsFee && !feePaid) {
      if (!treasury) {
        return NextResponse.json(
          {
            error: 'Treasury wallet is not configured. Set RAFFLE_RECIPIENT_WALLET.',
          },
          { status: 500 }
        )
      }
      if (!feeTransactionSignature) {
        return NextResponse.json(
          {
            error: `Pay the ${feeSol} SOL cancellation fee to the platform treasury from this wallet, then try again.`,
            requiresCancellationFee: true,
            feeSol,
            treasury,
          },
          { status: 400 }
        )
      }
      if (await isCancellationFeeTxUsedElsewhere(feeTransactionSignature, id)) {
        return NextResponse.json(
          { error: 'This transaction was already used for a cancellation fee.' },
          { status: 400 }
        )
      }
      const v = await verifyCancellationFeeTransaction(feeTransactionSignature, wallet, treasury)
      if (!v.valid) {
        return NextResponse.json(
          {
            error: v.error ?? 'Could not verify cancellation fee transaction.',
            requiresCancellationFee: true,
            feeSol,
            treasury,
          },
          { status: 400 }
        )
      }
      const nowIso = new Date().toISOString()
      await updateRaffle(id, {
        cancellation_fee_paid_at: nowIso,
        cancellation_fee_payment_tx: feeTransactionSignature,
      })
      return NextResponse.json({
        success: true,
        message: 'Cancellation fee recorded. An admin can now complete cancellation in Owl Vision.',
        feeRecorded: true,
      })
    }

    if (alreadyRequested) {
      return NextResponse.json(
        { error: 'Cancellation already requested. Waiting for admin approval.' },
        { status: 400 }
      )
    }

    if (needsFee) {
      if (!treasury) {
        return NextResponse.json(
          {
            error: 'Treasury wallet is not configured. Set RAFFLE_RECIPIENT_WALLET.',
          },
          { status: 500 }
        )
      }
      if (!feeTransactionSignature) {
        return NextResponse.json(
          {
            error: `This raffle has already started. Pay ${feeSol} SOL to the platform treasury to request cancellation.`,
            requiresCancellationFee: true,
            feeSol,
            treasury,
          },
          { status: 400 }
        )
      }
      if (await isCancellationFeeTxUsedElsewhere(feeTransactionSignature, id)) {
        return NextResponse.json(
          { error: 'This transaction was already used for a cancellation fee.' },
          { status: 400 }
        )
      }
      const v = await verifyCancellationFeeTransaction(feeTransactionSignature, wallet, treasury)
      if (!v.valid) {
        return NextResponse.json(
          {
            error: v.error ?? 'Could not verify cancellation fee transaction. Ensure your wallet has enough SOL and try again.',
            requiresCancellationFee: true,
            feeSol,
            treasury,
          },
          { status: 400 }
        )
      }
    }

    const now = new Date().toISOString()
    const patch: Parameters<typeof updateRaffle>[1] = {
      cancellation_requested_at: now,
    }
    if (needsFee && feeTransactionSignature) {
      patch.cancellation_fee_paid_at = now
      patch.cancellation_fee_payment_tx = feeTransactionSignature
    }

    await updateRaffle(id, patch)

    return NextResponse.json({
      success: true,
      message: 'Cancellation requested. An admin will review in Owl Vision.',
    })
  } catch (err) {
    console.error('[POST /api/raffles/[id]/request-cancellation]', err)
    return NextResponse.json(
      { error: 'Failed to request cancellation' },
      { status: 500 }
    )
  }
}
