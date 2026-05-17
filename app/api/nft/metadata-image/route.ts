import { NextRequest, NextResponse } from 'next/server'
import { fetchNftMintMetaFromHelius } from '@/lib/nft-helius-image'
import { getHeliusRpcUrl } from '@/lib/helius-rpc-url'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/nft/metadata-image?mint=<address>
 * Returns image URI and optional name from Helius DAS getAsset (for raffle / nesting artwork).
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

    const preferMainnet =
      request.nextUrl.searchParams.get('preferMainnet') === '1' ||
      request.nextUrl.searchParams.get('preferMainnet') === 'true'
    const meta = await fetchNftMintMetaFromHelius(mint, { preferMainnet })
    return NextResponse.json(
      { image: meta?.image ?? null, name: meta?.name ?? null },
      { status: 200 }
    )
  } catch (e) {
    console.error('[nft/metadata-image]', e)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
