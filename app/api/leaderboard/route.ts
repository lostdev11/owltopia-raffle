import { NextResponse } from 'next/server'
import { getLeaderboardWithMeta, parseLeaderboardPeriodFromSearchParams } from '@/lib/db/leaderboard'

export const dynamic = 'force-dynamic'
const PUBLIC_CACHE_HEADERS = { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' }

/**
 * GET /api/leaderboard
 * Returns top 10 by raffles entered, tickets purchased, raffles created, raffles won, and tickets sold (creators).
 * Rollup rules: `period.leaderboardRules` is `legacy` (historic) or `threshold` (draw goal met; see LEADERBOARD_NEW_RULES_EFFECTIVE_MONTH).
 * All-time stays legacy. Founder/treasury wallets are not ranked personally; their buys still credit creators’ sold stats. LEADERBOARD_EXCLUDED_WALLETS adds extras.
 * Entries omit complimentary/refunded/zero paid.
 * Tickets purchased cap per wallet per raffle; tickets sold need distinct buyers — lib/leaderboard/hardening.ts.
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
    return NextResponse.json(
      { ...leaderboard, period: meta },
      { headers: PUBLIC_CACHE_HEADERS }
    )
  } catch (error) {
    console.error('Leaderboard API error:', error)
    return NextResponse.json(
      { error: 'Failed to load leaderboard' },
      { status: 500 }
    )
  }
}
