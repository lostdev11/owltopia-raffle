import { NextRequest, NextResponse } from 'next/server'
import { lookupOrbisNftUrl } from '@/lib/nft-marketplace-orbis'

/**
 * GET /api/nft-marketplace/orbis-url?mint=...
 * Resolves a direct Orbis item URL when the mint is indexed.
 */
export async function GET(request: NextRequest) {
  const mint = request.nextUrl.searchParams.get('mint')?.trim()
  if (!mint) {
    return NextResponse.json({ error: 'mint is required' }, { status: 400 })
  }

  const result = await lookupOrbisNftUrl(mint)
  if (result.found) {
    return NextResponse.json(
      {
        found: true,
        collectionPathname: result.collectionPathname,
        url: result.url,
      },
      { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' } },
    )
  }

  return NextResponse.json(
    { found: false, url: null },
    { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600' } },
  )
}
