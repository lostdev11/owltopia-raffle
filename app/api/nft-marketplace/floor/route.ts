import { NextRequest, NextResponse } from 'next/server'
import { lookupNftFloorPrice } from '@/lib/nft-marketplace-floor'
import { isValidSolanaPubkey } from '@/lib/solana/validate-pubkey'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const IP_LIMIT = 40
const WINDOW_MS = 60_000

/**
 * GET /api/nft-marketplace/floor?mint=...&collection=...
 * Live Solana NFT collection floor (Tensor, Magic Eden, Orbis). Pass mint, collection, or both.
 */
export async function GET(request: NextRequest) {
  const ip = getClientIp(request)
  const rl = rateLimit(`nft-floor:${ip}`, IP_LIMIT, WINDOW_MS)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const mintRaw = request.nextUrl.searchParams.get('mint')?.trim() || null
  const collectionRaw = request.nextUrl.searchParams.get('collection')?.trim() || null

  if (!mintRaw && !collectionRaw) {
    return NextResponse.json({ error: 'mint or collection is required' }, { status: 400 })
  }
  if (mintRaw && !isValidSolanaPubkey(mintRaw)) {
    return NextResponse.json({ error: 'mint is not a valid Solana address' }, { status: 400 })
  }
  if (collectionRaw && !isValidSolanaPubkey(collectionRaw)) {
    return NextResponse.json({ error: 'collection is not a valid Solana address' }, { status: 400 })
  }

  try {
    const result = await lookupNftFloorPrice({ mint: mintRaw, collection: collectionRaw })
    const cacheControl = result.found
      ? 'public, s-maxage=60, stale-while-revalidate=300'
      : 'public, s-maxage=20, stale-while-revalidate=60'
    return NextResponse.json(result, { headers: { 'Cache-Control': cacheControl } })
  } catch (e) {
    console.error('[nft-marketplace/floor]', e)
    return NextResponse.json({ error: 'Unable to look up floor price' }, { status: 502 })
  }
}
