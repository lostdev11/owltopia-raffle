import { NextRequest, NextResponse } from 'next/server'
import { fetchNftMarketFloorByMint, formatMarketFloorSol } from '@/lib/nft-floor-price-fetch'

export const dynamic = 'force-dynamic'

/**
 * GET /api/nft-marketplace/floor?mint=...
 * Optional: &collectionSymbol=okay_bears
 * Returns Magic Eden collection floor in SOL for create-time preview (does not write DB).
 */
export async function GET(request: NextRequest) {
  const mint = request.nextUrl.searchParams.get('mint')?.trim()
  if (!mint) {
    return NextResponse.json({ error: 'mint is required' }, { status: 400 })
  }
  const collectionSymbol = request.nextUrl.searchParams.get('collectionSymbol')?.trim() || null

  const result = await fetchNftMarketFloorByMint(mint, { collectionSymbol })

  if (!result.ok) {
    return NextResponse.json(
      {
        found: false,
        floorSol: null,
        floorSolDisplay: null,
        source: result.source,
        collectionSymbol: result.collectionSymbol,
        collectionName: result.collectionName,
        reason: result.reason,
      },
      { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } }
    )
  }

  return NextResponse.json(
    {
      found: true,
      floorSol: result.floorSol,
      floorSolDisplay: formatMarketFloorSol(result.floorSol),
      source: result.source,
      collectionSymbol: result.collectionSymbol,
      collectionName: result.collectionName,
    },
    { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } }
  )
}
