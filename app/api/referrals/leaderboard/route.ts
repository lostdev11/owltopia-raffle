import { NextResponse } from 'next/server'
import { getReferralLeaderboard } from '@/lib/db/referrals'
import { getDisplayNamesByWallets } from '@/lib/db/wallet-profiles'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { isReferralAttributionEnabled } from '@/lib/referrals/config'

export const dynamic = 'force-dynamic'
const PUBLIC_CACHE_HEADERS = { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' }

const IP_LIMIT = 40
const WINDOW_MS = 60_000

/**
 * GET /api/referrals/leaderboard
 * Public. Rankings use confirmed, non-refunded entries only (server aggregate).
 */
export async function GET(request: Request) {
  try {
    const ip = getClientIp(request as Request)
    const rl = rateLimit(`referral-lb:${ip}`, IP_LIMIT, WINDOW_MS)
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': '60' } })
    }

    if (!isReferralAttributionEnabled()) {
      return NextResponse.json(
        { entries: [], displayNames: {} },
        { headers: PUBLIC_CACHE_HEADERS }
      )
    }

    const rows = await getReferralLeaderboard(10)
    const wallets = rows.map((r) => r.wallet_address)
    const displayNames = await getDisplayNamesByWallets(wallets)

    return NextResponse.json({
      entries: rows.map((r, i) => ({
        rank: i + 1,
        wallet: r.wallet_address,
        referredUsers: Number(r.referred_users),
        referredTickets: Number(r.referred_entries),
      })),
      displayNames,
    }, { headers: PUBLIC_CACHE_HEADERS })
  } catch (e) {
    console.error('[referrals/leaderboard]', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to load referral leaderboard' }, { status: 500 })
  }
}
