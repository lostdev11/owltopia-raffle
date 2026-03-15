import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { getRaffleById, updateRaffle } from '@/lib/db/raffles'

export const dynamic = 'force-dynamic'

/**
 * POST /api/raffles/[id]/request-cancellation
 * Creator requests cancellation. Admin accepts in Owl Vision. Ticket buyers get refunds in all cases. Within 24h: no fee to host. After 24h: host is charged cancellation fee.
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

    if (raffle.cancellation_requested_at) {
      return NextResponse.json(
        { error: 'Cancellation already requested. Waiting for admin approval.' },
        { status: 400 }
      )
    }

    const now = new Date().toISOString()
    await updateRaffle(id, {
      cancellation_requested_at: now,
    })

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
