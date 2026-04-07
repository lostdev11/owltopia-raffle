import { NextRequest, NextResponse } from 'next/server'
import { fetchNftImageUriFromHelius } from '@/lib/nft-helius-image'
import { getHeliusRpcUrl } from '@/lib/helius-rpc-url'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/nft/metadata-image?mint=<address>
 * Returns current image URI from Helius DAS getAsset (for raffle artwork when stored URL is stale).
 */
export async function GET(request: NextRequest) {
  try {
    const mint = request.nextUrl.searchParams.get('mint')?.trim()
    if (!mint) {
      return NextResponse.json({ error: 'Missing mint' }, { status: 400 })
    }

    if (!getHeliusRpcUrl()) {
      return NextResponse.json({ error: 'NFT API not configured' }, { status: 503 })
    }

    const image = await fetchNftImageUriFromHelius(mint)
    return NextResponse.json({ image: image ?? null }, { status: 200 })
  } catch (e) {
    console.error('[nft/metadata-image]', e)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
