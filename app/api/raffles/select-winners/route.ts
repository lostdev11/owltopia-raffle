import { NextRequest, NextResponse } from 'next/server'
import { 
  getEndedRafflesWithoutWinner, 
  selectWinner,
  getRaffleById 
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

      // Check if raffle has ended
      if (new Date(raffle.end_time) > new Date()) {
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

      const winnerWallet = await selectWinner(raffleId)
      
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
