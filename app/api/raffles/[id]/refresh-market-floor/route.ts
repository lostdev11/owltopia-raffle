import { NextRequest, NextResponse } from 'next/server'
import { getRaffleById } from '@/lib/db/raffles'
import { formatMarketFloorSol } from '@/lib/nft-floor-price-fetch'
import { isMarketFloorStale, refreshRaffleMarketFloor } from '@/lib/raffles/refresh-market-floors'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * POST /api/raffles/[id]/refresh-market-floor
 * Lazily refreshes market_floor_* for a live/ready_to_draw NFT raffle when stale.
 * Never touches listed floor_price / ticket_price / min_tickets.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<Record<string, string | string[] | undefined>> }
) {
  try {
    const params = await context.params
    const id = params.id
    if (typeof id !== 'string' || !id.trim()) {
      return NextResponse.json({ error: 'Invalid raffle id' }, { status: 400 })
    }

    const force = request.nextUrl.searchParams.get('force') === '1'
    const raffle = await getRaffleById(id)
    if (!raffle) {
      return NextResponse.json({ error: 'Raffle not found' }, { status: 404 })
    }

    if ((raffle.prize_type || '').toLowerCase() !== 'nft') {
      return NextResponse.json({ error: 'Market floor only applies to NFT raffles' }, { status: 400 })
    }

    const mint = (raffle.nft_mint_address ?? '').trim()
    if (!mint) {
      return NextResponse.json({ error: 'Raffle has no NFT mint' }, { status: 400 })
    }

    const status = raffle.status
    if (status !== 'live' && status !== 'ready_to_draw' && status !== 'draft') {
      return NextResponse.json(
        {
          ok: true,
          refreshed: false,
          skipped: 'terminal_status',
          market_floor_sol: raffle.market_floor_sol ?? null,
          market_floor_fetched_at: raffle.market_floor_fetched_at ?? null,
          market_floor_source: raffle.market_floor_source ?? null,
          market_floor_collection_symbol: raffle.market_floor_collection_symbol ?? null,
          market_floor_sol_display:
            raffle.market_floor_sol != null ? formatMarketFloorSol(raffle.market_floor_sol) : null,
        },
        { status: 200 }
      )
    }

    if (!force && !isMarketFloorStale(raffle.market_floor_fetched_at)) {
      return NextResponse.json({
        ok: true,
        refreshed: false,
        skipped: 'fresh',
        market_floor_sol: raffle.market_floor_sol ?? null,
        market_floor_fetched_at: raffle.market_floor_fetched_at ?? null,
        market_floor_source: raffle.market_floor_source ?? null,
        market_floor_collection_symbol: raffle.market_floor_collection_symbol ?? null,
        market_floor_sol_display:
          raffle.market_floor_sol != null ? formatMarketFloorSol(raffle.market_floor_sol) : null,
      })
    }

    const result = await refreshRaffleMarketFloor({
      raffleId: raffle.id,
      nftMintAddress: mint,
      collectionSymbol: raffle.market_floor_collection_symbol,
      force: true,
      fetchedAt: raffle.market_floor_fetched_at,
    })

    if (result.error === 'market_floor columns not applied') {
      return NextResponse.json(
        { ok: false, error: 'Market floor columns are not available yet' },
        { status: 503 }
      )
    }

    const floorSol = result.floorSol ?? null
    return NextResponse.json({
      ok: true,
      refreshed: result.refreshed,
      skipped: result.skipped ?? null,
      error: result.error ?? null,
      market_floor_sol: floorSol,
      market_floor_fetched_at: result.refreshed ? new Date().toISOString() : raffle.market_floor_fetched_at,
      market_floor_source: result.source ?? raffle.market_floor_source ?? null,
      market_floor_collection_symbol: raffle.market_floor_collection_symbol ?? null,
      market_floor_sol_display: floorSol != null ? formatMarketFloorSol(floorSol) : null,
    })
  } catch (err) {
    console.error('[POST /api/raffles/[id]/refresh-market-floor]', err)
    return NextResponse.json({ error: 'Failed to refresh market floor' }, { status: 500 })
  }
}
