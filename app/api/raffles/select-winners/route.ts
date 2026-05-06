import { NextRequest, NextResponse } from 'next/server'
import {
  getEndedRafflesWithoutWinner,
  selectWinner,
  getRaffleById,
  getEntriesByRaffleId,
  canSelectWinner,
  updateRaffle,
  getRaffleMinimum,
} from '@/lib/db/raffles'
import { processEndedRafflesWithoutWinners } from '@/lib/draw-ended-raffles'
import { hasExhaustedMinThresholdTimeExtensions } from '@/lib/raffles/ticket-escrow-policy'
import { buildMinThresholdMissExtensionPatch } from '@/lib/raffles/min-threshold-extension'
import { finalizeMinThresholdTerminalFailure } from '@/lib/raffles/min-threshold-terminal'
import { requireFullAdminSession } from '@/lib/auth-server'
import { safeErrorMessage } from '@/lib/safe-error'

// Force dynamic rendering
export const dynamic = 'force-dynamic'

/**
 * POST /api/raffles/select-winners
 * Selects winners for all ended raffles that don't have a winner yet.
 * Admin only (session required).
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const body = await request.json().catch(() => ({}))
    const { raffleId } = body

    // If specific raffle ID provided, select winner for that raffle only
    if (raffleId) {
      const raffle = await getRaffleById(raffleId)
      
      if (!raffle) {
        return NextResponse.json(
          { error: 'Raffle not found' },
          { status: 404 }
        )
      }

      // Check if raffle has ended (use end_time only; after restore that is the extended time)
      const endTimeToCheck = new Date(raffle.end_time)
      if (endTimeToCheck > new Date()) {
        return NextResponse.json(
          { error: 'Raffle has not ended yet' },
          { status: 400 }
        )
      }

      // Check if winner already selected
      if (raffle.winner_wallet) {
        return NextResponse.json(
          { 
            message: 'Winner already selected',
            raffleId: raffle.id,
            winnerWallet: raffle.winner_wallet,
            winnerSelectedAt: raffle.winner_selected_at
          },
          { status: 200 }
        )
      }

      // Check if raffle can have winner selected (threshold met and at least one confirmed ticket) unless force override
      const entries = await getEntriesByRaffleId(raffleId)
      const forceOverride = body.forceOverride === true
      
      if (!forceOverride) {
        const canDraw = canSelectWinner(raffle, entries)

        if (!canDraw) {
          // Same rules as cron / {@link processOneEndedRaffle}: extend once, then refund-available + NFT return.
          if (hasExhaustedMinThresholdTimeExtensions(raffle)) {
            await finalizeMinThresholdTerminalFailure(raffle.id)
            return NextResponse.json(
              {
                error:
                  'Draw requirements were not met after the extension. Raffle set to refund-available; NFT returned to creator when possible.',
                raffleId: raffle.id,
                minTickets: getRaffleMinimum(raffle) ?? raffle.min_tickets,
                ticketsSold: entries
                  .filter((e) => e.status === 'confirmed' && !e.refunded_at)
                  .reduce((sum, entry) => sum + Number(entry.ticket_quantity ?? 0), 0),
                failedRefundAvailable: true,
              },
              { status: 400 }
            )
          }

          const patch = buildMinThresholdMissExtensionPatch(raffle)
          await updateRaffle(raffle.id, patch)

          return NextResponse.json(
            {
              error:
                'Raffle cannot draw yet (ticket threshold not met or no confirmed sales where required). Deadline extended.',
              raffleId: raffle.id,
              minTickets: getRaffleMinimum(raffle) ?? raffle.min_tickets,
              ticketsSold: entries
                .filter((e) => e.status === 'confirmed' && !e.refunded_at)
                .reduce((sum, entry) => sum + Number(entry.ticket_quantity ?? 0), 0),
              extended: true,
              newEndTime: patch.end_time,
            },
            { status: 400 }
          )
        }
      }

      const winnerWallet = await selectWinner(raffleId, forceOverride)
      
      if (!winnerWallet) {
        return NextResponse.json(
          { error: 'No confirmed entries found for this raffle' },
          { status: 400 }
        )
      }

      return NextResponse.json({
        success: true,
        raffleId: raffle.id,
        winnerWallet,
        message: 'Winner selected successfully',
      })
    }

    // Otherwise, process all ended raffles without winners (same logic as cron)
    const results = await processEndedRafflesWithoutWinners()

    return NextResponse.json({
      success: true,
      message: results.length === 0 ? 'No ended raffles without winners found' : undefined,
      processedCount: results.length,
      results
    })
  } catch (error) {
    console.error('Error selecting winners:', error)
    return NextResponse.json(
      { error: safeErrorMessage(error) },
      { status: 500 }
    )
  }
}

/**
 * GET /api/raffles/select-winners
 * Returns list of ended raffles without winners. Admin only (session required).
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const endedRaffles = await getEndedRafflesWithoutWinner()

    return NextResponse.json({
      count: endedRaffles.length,
      raffles: endedRaffles.map((r) => ({
        id: r.id,
        title: r.title,
        slug: r.slug,
        endTime: r.end_time,
      })),
    })
  } catch (error) {
    console.error('Error fetching ended raffles:', error)
    return NextResponse.json(
      { error: safeErrorMessage(error) },
      { status: 500 }
    )
  }
}
