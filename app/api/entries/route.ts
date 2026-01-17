import { NextRequest, NextResponse } from 'next/server'
import { getEntriesByRaffleId } from '@/lib/db/raffles'

// Force dynamic rendering to prevent caching stale entry data
export const dynamic = 'force-dynamic'
export const revalidate = 0

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

    // Return response with no-cache headers to ensure fresh data
    return NextResponse.json(entries, { 
      status: 200,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      }
    })
  } catch (error) {
    console.error('Error fetching entries:', error)
    const errorMessage = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    )
  }
}