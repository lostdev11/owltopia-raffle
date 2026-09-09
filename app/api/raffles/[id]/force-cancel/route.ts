import { NextRequest, NextResponse } from 'next/server'

import { requireFullAdminSession } from '@/lib/auth-server'
import { getMilestonesByRaffleId } from '@/lib/db/raffle-milestones'
import { getRaffleById } from '@/lib/db/raffles'
import { canAdminForceCancelMilestoneRaffle } from '@/lib/raffles/force-cancel-eligibility'
import { finalizeRaffleCancellation } from '@/lib/raffles/finalize-cancellation'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * POST /api/raffles/[id]/force-cancel
 * Full admin cancels a live milestone raffle without a creator cancellation request.
 * Same settlement as accept-cancellation (refunds, prize return, milestone deposit return).
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<Record<string, string | string[] | undefined>> }
) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const params = await context.params
    const id = params.id
    if (typeof id !== 'string') {
      return NextResponse.json({ error: 'Invalid raffle id' }, { status: 400 })
    }

    const raffle = await getRaffleById(id)
    if (!raffle) {
      return NextResponse.json({ error: 'Raffle not found' }, { status: 404 })
    }

    if (raffle.status === 'cancelled' && raffle.cancelled_at) {
      return NextResponse.json({ error: 'Raffle is already cancelled' }, { status: 400 })
    }

    const milestones = await getMilestonesByRaffleId(id)
    if (
      !canAdminForceCancelMilestoneRaffle({
        status: raffle.status,
        milestoneCount: milestones.length,
        cancellationRequestedAt: raffle.cancellation_requested_at,
        cancellationFeePaidAt: raffle.cancellation_fee_paid_at,
        cancelledAt: raffle.cancelled_at,
        winnerWallet: raffle.winner_wallet,
        winnerSelectedAt: raffle.winner_selected_at,
      })
    ) {
      return NextResponse.json(
        {
          error:
            'Force-cancel is only for live milestone raffles with no creator cancellation request and no winner yet. Use Accept cancellation if the creator already requested cancel.',
        },
        { status: 400 }
      )
    }

    const result = await finalizeRaffleCancellation({
      raffleId: id,
      raffle,
      adminForceCancel: true,
    })

    return NextResponse.json(result)
  } catch (err) {
    console.error('[POST /api/raffles/[id]/force-cancel]', err)
    return NextResponse.json({ error: safeErrorMessage(err) }, { status: 500 })
  }
}
