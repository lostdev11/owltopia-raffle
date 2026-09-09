import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { getRaffleById } from '@/lib/db/raffles'
import { finalizeRaffleCancellation } from '@/lib/raffles/finalize-cancellation'

export const dynamic = 'force-dynamic'

/**
 * POST /api/raffles/[id]/accept-cancellation
 * Full admin accepts a cancellation request. Creators who started the raffle are normally expected to pay the
 * on-chain cancellation fee first; admins may still accept without a recorded fee when support agrees (fee fields
 * stay unset / refund policy reflects no host fee). Ticket buyers with funds-escrow entries can claim refunds on the dashboard.
 * After the raffle is marked cancelled, attempts the same automatic escrow → creator transfer as
 * POST /return-prize-to-creator (NFT and partner SPL prizes). Non-escrow prize types are skipped.
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

    if (!raffle.cancellation_requested_at && !raffle.cancellation_fee_paid_at) {
      return NextResponse.json(
        { error: 'No cancellation request pending for this raffle' },
        { status: 400 }
      )
    }

    if (raffle.status === 'cancelled' && raffle.cancelled_at) {
      return NextResponse.json(
        { error: 'Raffle is already cancelled' },
        { status: 400 }
      )
    }

    const result = await finalizeRaffleCancellation({ raffleId: id, raffle })
    return NextResponse.json(result)
  } catch (err) {
    console.error('[POST /api/raffles/[id]/accept-cancellation]', err)
    return NextResponse.json(
      { error: 'Failed to accept cancellation' },
      { status: 500 }
    )
  }
}
