import { NextRequest, NextResponse } from 'next/server'

import { requireFullAdminSession } from '@/lib/auth-server'
import { getMilestoneById } from '@/lib/db/raffle-milestones'
import { getRaffleById } from '@/lib/db/raffles'
import { returnMilestoneDepositToCreator } from '@/lib/raffles/milestones/payout'
import {
  isMilestoneDepositReturnable,
  isTerminalRaffleForMilestoneReturn,
} from '@/lib/raffles/milestones/return-eligibility'
import { voidMilestonesForTerminalRaffle } from '@/lib/raffles/milestones/cancel-side-effects'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * POST /api/raffles/[id]/milestones/[milestoneId]/return-deposit
 * Full admin returns a prefunded crypto milestone deposit to the raffle creator (funds escrow).
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<Record<string, string | string[] | undefined>> }
) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const params = await context.params
    const raffleId = typeof params.id === 'string' ? params.id : ''
    const milestoneId = typeof params.milestoneId === 'string' ? params.milestoneId : ''
    if (!raffleId || !milestoneId) {
      return NextResponse.json({ error: 'Invalid raffle or milestone id' }, { status: 400 })
    }

    const raffle = await getRaffleById(raffleId)
    if (!raffle) {
      return NextResponse.json({ error: 'Raffle not found' }, { status: 404 })
    }

    if (!isTerminalRaffleForMilestoneReturn(raffle.status)) {
      return NextResponse.json(
        {
          error:
            'Milestone deposit returns are only available for cancelled or failed-refund raffles.',
        },
        { status: 400 }
      )
    }

    let milestone = await getMilestoneById(milestoneId)
    if (!milestone || milestone.raffle_id !== raffleId) {
      return NextResponse.json({ error: 'Milestone not found' }, { status: 404 })
    }

    if (!isMilestoneDepositReturnable({ milestone, raffleStatus: raffle.status })) {
      if (milestone.status === 'awarded' || milestone.status === 'claimed') {
        await voidMilestonesForTerminalRaffle(raffleId)
        milestone = (await getMilestoneById(milestoneId)) ?? milestone
      }
    }

    if (!isMilestoneDepositReturnable({ milestone, raffleStatus: raffle.status })) {
      return NextResponse.json(
        {
          error:
            milestone.returned_at
              ? 'Milestone deposit was already returned.'
              : 'This milestone deposit is not returnable (not funded, already claimed, or raffle still active).',
        },
        { status: 400 }
      )
    }

    const result = await returnMilestoneDepositToCreator({ milestone, raffle })
    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? 'Return failed' }, { status: 400 })
    }

    return NextResponse.json({
      ok: true,
      transactionSignature: result.signature,
    })
  } catch (error) {
    console.error('[POST milestone return-deposit]', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
