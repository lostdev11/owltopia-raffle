import { NextRequest, NextResponse } from 'next/server'
import { getRaffleById } from '@/lib/db/raffles'
import { requireSession } from '@/lib/auth-server'
import { getAdminRole } from '@/lib/db/admins'
import { recordModerationListingFeePayment } from '@/lib/raffles/record-moderation-listing-fee'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * POST /api/raffles/[id]/verify-moderation-listing-fee
 * Body: { feeTransactionSignature: string }
 * Verifies moderation listing deposit for blacklisted creators before go-live.
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
    const feeTransactionSignature =
      typeof body.feeTransactionSignature === 'string'
        ? body.feeTransactionSignature.trim()
        : typeof body.fee_tx === 'string'
          ? body.fee_tx.trim()
          : ''

    const raffle = await getRaffleById(id)
    if (!raffle) {
      return NextResponse.json({ error: 'Raffle not found' }, { status: 404 })
    }

    const creatorWallet = (raffle.creator_wallet || raffle.created_by || '').trim()
    const isCreator = creatorWallet && session.wallet === creatorWallet
    const isAdmin = (await getAdminRole(session.wallet)) !== null
    if (!isCreator && !isAdmin) {
      return NextResponse.json(
        { error: 'Only the raffle creator or an admin can verify the moderation listing deposit' },
        { status: 403 }
      )
    }

    const result = await recordModerationListingFeePayment({
      raffleId: id,
      raffle,
      creatorWallet: creatorWallet || session.wallet,
      feeTransactionSignature,
    })

    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.error,
          feeLamports: result.feeLamports,
          treasury: result.treasury,
        },
        { status: result.status }
      )
    }

    return NextResponse.json({
      success: true,
      alreadyRecorded: result.alreadyRecorded,
      published: result.published,
    })
  } catch (error) {
    console.error('[verify-moderation-listing-fee]', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
