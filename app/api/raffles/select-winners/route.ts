import { NextRequest, NextResponse } from 'next/server'
import {
  getEndedRafflesWithoutWinner,
  selectWinner,
  getRaffleById,
  getEntriesByRaffleId,
  isRaffleEligibleToDraw,
  canSelectWinner,
  updateRaffle,
} from '@/lib/db/raffles'
import { processEndedRafflesWithoutWinners } from '@/lib/draw-ended-raffles'
import { hasExhaustedMinThresholdTimeExtensions } from '@/lib/raffles/ticket-escrow-policy'
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
        const hasMinTickets = raffle.min_tickets != null && raffle.min_tickets > 0
        const meetsMinTickets = hasMinTickets ? isRaffleEligibleToDraw(raffle, entries) : false

        if (!canDraw) {
          // Ticket threshold (min_tickets) not met: extend up to two times; then refunds + NFT return.
          if (hasMinTickets && !meetsMinTickets) {
            if (hasExhaustedMinThresholdTimeExtensions(raffle)) {
              await finalizeMinThresholdTerminalFailure(raffle.id)
              return NextResponse.json(
                {
                  error:
                    'Minimum still not met after two extensions. Raffle set to refund-available; NFT returned to creator when possible.',
                  raffleId: raffle.id,
                  minTickets: raffle.min_tickets,
                  ticketsSold: entries
                    .filter((e) => e.status === 'confirmed')
                    .reduce((sum, entry) => sum + entry.ticket_quantity, 0),
                  failedRefundAvailable: true,
                },
                { status: 400 }
              )
            }

            const originalEndTime = raffle.original_end_time || raffle.end_time
            const startTimeMs = new Date(raffle.start_time).getTime()
            const originalEndMs = new Date(originalEndTime).getTime()
            const baseDurationMs = originalEndMs - startTimeMs
            const durationMs =
              baseDurationMs > 0 ? baseDurationMs : 7 * 24 * 60 * 60 * 1000

            const currentEndMs = new Date(raffle.end_time).getTime()
            const newEndTime = new Date(currentEndMs + durationMs)

            await updateRaffle(raffle.id, {
              original_end_time: originalEndTime,
              end_time: newEndTime.toISOString(),
              status: 'live',
              time_extension_count: (raffle.time_extension_count ?? 0) + 1,
            })

            return NextResponse.json(
              {
                error: 'Raffle does not meet minimum ticket requirements. Extended by another period.',
                raffleId: raffle.id,
                minTickets: raffle.min_tickets,
                ticketsSold: entries
                  .filter((e) => e.status === 'confirmed')
                  .reduce((sum, entry) => sum + Number(entry.ticket_quantity ?? 0), 0),
                extended: true,
                newEndTime: newEndTime.toISOString(),
              },
              { status: 400 }
            )
          } else if (!hasMinTickets) {
            return NextResponse.json(
              {
                error:
                  'Raffle has no minimum ticket threshold and cannot draw a winner (no confirmed tickets).',
                raffleId: raffle.id,
                minTickets: raffle.min_tickets,
                ticketsSold: entries
                  .filter((e) => e.status === 'confirmed')
                  .reduce((sum, entry) => sum + Number(entry.ticket_quantity ?? 0), 0),
              },
              { status: 400 }
            )
          }
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
