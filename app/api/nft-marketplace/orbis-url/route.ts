import { NextRequest, NextResponse } from 'next/server'
import { orbisNftUrl } from '@/lib/nft-marketplace-links'

const ORBIS_LOOKUP_URL = 'https://www.orbisonsol.io/api/marketplace'

type OrbisLookupMintResponse = {
  success?: boolean
  found?: boolean
  collectionPathname?: string
}

/**
 * GET /api/nft-marketplace/orbis-url?mint=...
 * Resolves Orbis collection pathname for a mint so deep links open the NFT detail modal.
 */
export async function GET(request: NextRequest) {
  const mint = request.nextUrl.searchParams.get('mint')?.trim()
  if (!mint) {
    return NextResponse.json({ error: 'mint is required' }, { status: 400 })
  }

  try {
    const res = await fetch(ORBIS_LOOKUP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'lookupMint', mint }),
      next: { revalidate: 3600 },
    })
    const data = (await res.json()) as OrbisLookupMintResponse

    if (data.success && data.found && data.collectionPathname?.trim()) {
      const collectionPathname = data.collectionPathname.trim()
      const url = orbisNftUrl(mint, { collectionPathname })
      return NextResponse.json(
        { found: true, collectionPathname, url },
        { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' } },
      )
    }

    return NextResponse.json(
      { found: false, url: null },
      { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600' } },
    )
  } catch {
    return NextResponse.json({ found: false, url: null, error: 'lookup_failed' }, { status: 502 })
  }
}
