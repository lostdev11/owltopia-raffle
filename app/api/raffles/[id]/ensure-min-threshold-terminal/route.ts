import { NextRequest, NextResponse } from 'next/server'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import {
  getEntriesByRaffleId,
  getRaffleById,
  getRaffleMinimum,
  isRaffleEligibleToDraw,
} from '@/lib/db/raffles'
import { hasExhaustedMinThresholdTimeExtensions } from '@/lib/raffles/ticket-escrow-policy'
import { finalizeMinThresholdTerminalFailure } from '@/lib/raffles/min-threshold-terminal'

export const dynamic = 'force-dynamic'

/**
 * POST /api/raffles/[id]/ensure-min-threshold-terminal
 * Idempotent: moves a stuck ended raffle (min not met after max extension) to `failed_refund_available`
 * so buyers can claim escrow refunds. Public + rate-limited; same rules as the raffle page auto-runner.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<Record<string, string | string[] | undefined>> }
) {
  try {
    const ip = getClientIp(request)
    const rl = rateLimit(`ensure-min-threshold-terminal:${ip}`, 30, 60_000)
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': '60' } })
    }

    const params = await context.params
    const raffleId = params.id
    if (typeof raffleId !== 'string') {
      return NextResponse.json({ error: 'Invalid raffle id' }, { status: 400 })
    }

    const idRl = rateLimit(`ensure-min-threshold-terminal:raffle:${raffleId}`, 12, 60_000)
    if (!idRl.allowed) {
      return NextResponse.json({ error: 'Too many requests for this raffle' }, { status: 429 })
    }

    const raffle = await getRaffleById(raffleId)
    if (!raffle) {
      return NextResponse.json({ error: 'Raffle not found' }, { status: 404 })
    }

    if (raffle.status === 'failed_refund_available') {
      return NextResponse.json({
        success: true as const,
        status: raffle.status,
        alreadyTerminal: true,
      })
    }

    const now = new Date()
    if (new Date(raffle.end_time) > now) {
      return NextResponse.json({ error: 'Raffle has not ended yet' }, { status: 400 })
    }

    if ((raffle.winner_wallet && raffle.winner_wallet.trim()) || (raffle.winner_selected_at && String(raffle.winner_selected_at).trim())) {
      return NextResponse.json({ error: 'This raffle already has a winner' }, { status: 400 })
    }

    const entries = await getEntriesByRaffleId(raffleId)
    const min = getRaffleMinimum(raffle)
    if (min == null) {
      return NextResponse.json({ error: 'No draw threshold is set for this raffle' }, { status: 400 })
    }
    if (isRaffleEligibleToDraw(raffle, entries)) {
      return NextResponse.json({ error: 'Ticket minimum was met; refunds are not available' }, { status: 400 })
    }
    if (!hasExhaustedMinThresholdTimeExtensions(raffle)) {
      return NextResponse.json(
        { error: 'The extended deadline may still apply; try again after the listed end time.' },
        { status: 400 }
      )
    }

    const processable =
      raffle.status === 'live' ||
      raffle.status === 'ready_to_draw' ||
      raffle.status === 'pending_min_not_met'
    if (!processable) {
      return NextResponse.json(
        {
          error: `This raffle cannot be moved to refunds automatically (status: ${raffle.status ?? 'unknown'}). Contact support.`,
        },
        { status: 400 }
      )
    }

    await finalizeMinThresholdTerminalFailure(raffleId)
    const updated = await getRaffleById(raffleId)

    return NextResponse.json({
      success: true as const,
      status: updated?.status ?? 'failed_refund_available',
      alreadyTerminal: false,
    })
  } catch (e) {
    console.error('[ensure-min-threshold-terminal]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
