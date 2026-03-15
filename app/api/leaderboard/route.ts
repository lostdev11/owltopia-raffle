import { NextResponse } from 'next/server'
import { getLeaderboardTopTen } from '@/lib/db/leaderboard'

export const dynamic = 'force-dynamic'

/**
 * GET /api/leaderboard
 * Returns top 10 users by raffles entered, raffles created, and tickets sold.
 * Public endpoint.
 */
export async function GET() {
  try {
    const data = await getLeaderboardTopTen()
    return NextResponse.json(data)
  } catch (error) {
    console.error('Leaderboard API error:', error)
    return NextResponse.json(
      { error: 'Failed to load leaderboard' },
      { status: 500 }
    )
  }
}
