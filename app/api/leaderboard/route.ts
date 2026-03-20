import { NextResponse } from 'next/server'
import { getLeaderboardTopTen } from '@/lib/db/leaderboard'

export const dynamic = 'force-dynamic'

/**
 * GET /api/leaderboard
 * Returns top 10 by raffles entered, tickets purchased, raffles created, raffles won, and tickets sold (creators).
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
