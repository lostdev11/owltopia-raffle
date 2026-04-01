import { NextResponse } from 'next/server'
import { getLeaderboardWithMeta, parseLeaderboardPeriodFromSearchParams } from '@/lib/db/leaderboard'

export const dynamic = 'force-dynamic'

/**
 * GET /api/leaderboard
 * Returns top 10 by raffles entered, tickets purchased, raffles created, raffles won, and tickets sold (creators).
 * Query (UTC calendar):
 * - Default: period=month for the current UTC month.
 * - period=all — all-time (no date filter).
 * - period=year&year=YYYY — Jan 1–Dec 31 UTC for that year.
 * - period=month&year=YYYY&month=MM — that calendar month (MM 1–12).
 * Public endpoint.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const period = parseLeaderboardPeriodFromSearchParams(searchParams)
    const { leaderboard, period: meta } = await getLeaderboardWithMeta(period)
    return NextResponse.json({ ...leaderboard, period: meta })
  } catch (error) {
    console.error('Leaderboard API error:', error)
    return NextResponse.json(
      { error: 'Failed to load leaderboard' },
      { status: 500 }
    )
  }
}
