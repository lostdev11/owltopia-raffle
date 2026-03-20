import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { getRaffleById, updateRaffle } from '@/lib/db/raffles'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * POST /api/raffles/[id]/block-purchases
 * Admin blocks or unblocks ticket purchases for a raffle (e.g. NFT not in escrow, wrong prize, dispute).
 * Body: { block: boolean }
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

    let body: { block?: boolean }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const shouldBlock = body?.block === true

    const raffle = await getRaffleById(id)
    if (!raffle) {
      return NextResponse.json({ error: 'Raffle not found' }, { status: 404 })
    }

    const now = new Date().toISOString()
    await updateRaffle(id, {
      purchases_blocked_at: shouldBlock ? now : null,
    })

    return NextResponse.json({
      success: true,
      purchasesBlocked: shouldBlock,
      message: shouldBlock
        ? 'Ticket purchases blocked. No new tickets can be bought until unblocked.'
        : 'Ticket purchases unblocked.',
    })
  } catch (err) {
    console.error('[POST /api/raffles/[id]/block-purchases]', err)
    return NextResponse.json(
      { error: safeErrorMessage(err) },
      { status: 500 }
    )
  }
}
