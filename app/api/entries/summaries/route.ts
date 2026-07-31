import { NextRequest, NextResponse } from 'next/server'
import { getEntrySummariesByRaffleIds } from '@/lib/db/entry-summaries'
import { rateLimit, getClientIp } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_IDS = 80
const WINDOW = 60_000

/**
 * GET /api/entries/summaries?ids=uuid,uuid&wallet=optional
 * Batch aggregates for raffle list/carousel polling (Disk IO–friendly).
 */
export async function GET(request: NextRequest) {
  try {
    const ip = getClientIp(request)
    const rl = rateLimit(`entries-summaries:${ip}`, 120, WINDOW)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': '60' } }
      )
    }

    const { searchParams } = new URL(request.url)
    const idsParam = searchParams.get('ids') ?? ''
    const wallet = searchParams.get('wallet')?.trim() || null
    const ids = idsParam
      .split(',')
      .map((s) => s.trim())
      .filter((id) => UUID_REGEX.test(id))
      .slice(0, MAX_IDS)

    if (ids.length === 0) {
      return NextResponse.json(
        { error: 'Missing or invalid ids (comma-separated UUIDs)' },
        { status: 400 }
      )
    }

    const map = await getEntrySummariesByRaffleIds(ids, wallet)
    const summaries = ids.map((id) => {
      const s = map.get(id)!
      return {
        raffleId: s.raffleId,
        ticketsSold: s.ticketsSold,
        totalEntries: s.totalEntries,
        confirmedEntries: s.confirmedEntries,
        uniqueWallets: s.uniqueWallets,
        revenue: s.revenue,
        viewerConfirmedTickets: s.viewerConfirmedTickets,
      }
    })

    return NextResponse.json(
      { summaries },
      {
        status: 200,
        headers: {
          // Short CDN/browser cache — list polls every ~20s; aggregates change slowly.
          'Cache-Control': 'public, s-maxage=5, stale-while-revalidate=15',
        },
      }
    )
  } catch (error) {
    console.error('[GET /api/entries/summaries]', error)
    const errorMessage = error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
