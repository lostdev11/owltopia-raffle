import { NextRequest, NextResponse } from 'next/server'
import { getEntriesByRaffleId } from '@/lib/db/raffles'

/**
 * GET entries for a specific raffle
 * Query params: raffleId - the ID of the raffle
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const raffleId = searchParams.get('raffleId')

    if (!raffleId) {
      return NextResponse.json(
        { error: 'Missing required parameter: raffleId' },
        { status: 400 }
      )
    }

    const entries = await getEntriesByRaffleId(raffleId)

    return NextResponse.json(entries, { status: 200 })
  } catch (error) {
    console.error('Error fetching entries:', error)
    const errorMessage = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    )
  }
}