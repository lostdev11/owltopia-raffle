import { NextRequest, NextResponse } from 'next/server'
import { 
  getEndedRafflesWithoutWinner, 
  selectWinner,
  getRaffleById,
  getEntriesByRaffleId,
  isRaffleEligibleToDraw,
  canSelectWinner,
  updateRaffle
} from '@/lib/db/raffles'

// Force dynamic rendering
export const dynamic = 'force-dynamic'

/**
 * POST /api/raffles/select-winners
 * Selects winners for all ended raffles that don't have a winner yet.
 * Can also be called with a specific raffleId to select winner for that raffle only.
 */
export async function POST(request: NextRequest) {
  try {
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

      // Check if raffle can have winner selected (min tickets met AND 7 days passed) unless force override
      const entries = await getEntriesByRaffleId(raffleId)
      const forceOverride = body.forceOverride === true
      
      if (!forceOverride) {
        const canDraw = canSelectWinner(raffle, entries)
        const meetsMinTickets = isRaffleEligibleToDraw(raffle, entries)
        
        if (!canDraw) {
          // If min tickets not met, extend the raffle by 7 days
          if (!meetsMinTickets) {
            const now = new Date()
            const endTime = new Date(raffle.end_time)
            const originalEndTime = raffle.original_end_time || raffle.end_time
            const newEndTime = new Date(endTime)
            newEndTime.setDate(newEndTime.getDate() + 7)
            
            await updateRaffle(raffle.id, {
              original_end_time: originalEndTime,
              end_time: newEndTime.toISOString(),
              status: 'live'
            })
            
            return NextResponse.json(
              { 
                error: 'Raffle does not meet minimum ticket requirements. Extended by 7 days.',
                raffleId: raffle.id,
                minTickets: raffle.min_tickets,
                ticketsSold: entries.filter(e => e.status === 'confirmed')
                  .reduce((sum, entry) => sum + entry.ticket_quantity, 0),
                extended: true,
                newEndTime: newEndTime.toISOString()
              },
              { status: 400 }
            )
          } else {
            // Min tickets met but 7 days haven't passed
            return NextResponse.json(
              { 
                error: 'Raffle must wait 7 days after original end time before drawing winner',
                raffleId: raffle.id,
                minTickets: raffle.min_tickets,
                ticketsSold: entries.filter(e => e.status === 'confirmed')
                  .reduce((sum, entry) => sum + entry.ticket_quantity, 0),
                originalEndTime: raffle.original_end_time || raffle.end_time
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
        message: 'Winner selected successfully'
      })
    }

    // Otherwise, process all ended raffles without winners
    const endedRaffles = await getEndedRafflesWithoutWinner()
    
    if (endedRaffles.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No ended raffles without winners found',
        processedCount: 0
      })
    }

    const results = []
    
    for (const raffle of endedRaffles) {
      try {
        // Check if raffle can have winner selected (min tickets met AND 7 days passed)
        const entries = await getEntriesByRaffleId(raffle.id)
        const canDraw = canSelectWinner(raffle, entries)
        const meetsMinTickets = isRaffleEligibleToDraw(raffle, entries)
        
        if (!canDraw) {
          // If min tickets not met, extend the raffle by 7 days
          if (!meetsMinTickets) {
            const now = new Date()
            const endTime = new Date(raffle.end_time)
            const originalEndTime = raffle.original_end_time || raffle.end_time
            const newEndTime = new Date(endTime)
            newEndTime.setDate(newEndTime.getDate() + 7)
            
            await updateRaffle(raffle.id, {
              original_end_time: originalEndTime,
              end_time: newEndTime.toISOString(),
              status: 'live'
            })
            
            results.push({
              raffleId: raffle.id,
              raffleTitle: raffle.title,
              success: false,
              winnerWallet: null,
              error: `Minimum requirements not met (min: ${raffle.min_tickets || 'N/A'}, sold: ${entries.filter(e => e.status === 'confirmed').reduce((sum, entry) => sum + entry.ticket_quantity, 0)}). Extended by 7 days.`,
              extended: true
            })
          } else {
            // Min tickets met but 7 days haven't passed
            results.push({
              raffleId: raffle.id,
              raffleTitle: raffle.title,
              success: false,
              winnerWallet: null,
              error: `Raffle must wait 7 days after original end time before drawing winner`
            })
          }
          continue
        }
        
        const winnerWallet = await selectWinner(raffle.id)
        results.push({
          raffleId: raffle.id,
          raffleTitle: raffle.title,
          success: !!winnerWallet,
          winnerWallet: winnerWallet || null,
          error: winnerWallet ? null : 'No confirmed entries found'
        })
      } catch (error) {
        results.push({
          raffleId: raffle.id,
          raffleTitle: raffle.title,
          success: false,
          winnerWallet: null,
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    }

    return NextResponse.json({
      success: true,
      processedCount: results.length,
      results
    })
  } catch (error) {
    console.error('Error selecting winners:', error)
    const errorMessage = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    )
  }
}

/**
 * GET /api/raffles/select-winners
 * Returns list of ended raffles without winners (for monitoring/debugging)
 */
export async function GET() {
  try {
    const endedRaffles = await getEndedRafflesWithoutWinner()
    
    return NextResponse.json({
      count: endedRaffles.length,
      raffles: endedRaffles.map(r => ({
        id: r.id,
        title: r.title,
        slug: r.slug,
        endTime: r.end_time,
      }))
    })
  } catch (error) {
    console.error('Error fetching ended raffles:', error)
    const errorMessage = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    )
  }
}
