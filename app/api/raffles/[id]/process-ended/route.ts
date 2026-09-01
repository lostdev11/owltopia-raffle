import { NextRequest, NextResponse } from 'next/server'
import { getRaffleByIdOrSlug } from '@/lib/raffles/resolve-raffle-route-param'
import { runRaffleDrawOnVisit } from '@/lib/raffles/schedule-raffle-draw-on-visit'

export const dynamic = 'force-dynamic'
/** VRF commit+reveal may need up to ~75s; match cron headroom. */
export const maxDuration = 120

/**
 * POST /api/raffles/[id]/process-ended
 * Public: advance ended / sold-out raffles (draw, min-threshold extension, or terminal refund).
 * Called from the raffle detail page when a draw is pending so users are not blocked on SSR or `after()`.
 */
export async function POST(
  _request: NextRequest,
  context: { params: Promise<Record<string, string | string[] | undefined>> }
) {
  try {
    const params = await context.params
    const id = params.id
    if (typeof id !== 'string' || !id.trim()) {
      return NextResponse.json({ error: 'Invalid raffle id' }, { status: 400 })
    }

    const raffle = await getRaffleByIdOrSlug(id.trim())
    if (!raffle) {
      return NextResponse.json({ error: 'Raffle not found' }, { status: 404 })
    }

    await runRaffleDrawOnVisit(raffle)

    const refreshed = await getRaffleByIdOrSlug(id.trim())

    return NextResponse.json({
      ok: true,
      raffleId: raffle.id,
      status: refreshed?.status ?? raffle.status,
      hasWinner: Boolean(
        refreshed?.winner_wallet ||
          refreshed?.winner_selected_at ||
          raffle.winner_wallet ||
          raffle.winner_selected_at
      ),
    })
  } catch (error) {
    console.error('[api/raffles/process-ended]', error)
    return NextResponse.json({ error: 'server error' }, { status: 500 })
  }
}
