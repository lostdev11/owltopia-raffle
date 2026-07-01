import { NextRequest, NextResponse } from 'next/server'
import { fetchNftMintMetaBatchFromHelius } from '@/lib/nft-helius-image'
import { getHeliusRpcUrl } from '@/lib/helius-rpc-url'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const MAX_MINTS_PER_REQUEST = 24

/**
 * POST /api/nft/metadata-image/batch
 * Body: { mints: string[], preferMainnet?: boolean }
 */
export async function POST(request: NextRequest) {
  try {
    if (!getHeliusRpcUrl()) {
      return NextResponse.json({ error: 'NFT API not configured' }, { status: 503 })
    }

    const body: { mints?: unknown; preferMainnet?: unknown } = await request.json().catch(() => ({}))
    const raw = Array.isArray(body.mints) ? body.mints : []
    const mints = [...new Set(raw.map((m) => (typeof m === 'string' ? m.trim() : '')).filter(Boolean))].slice(
      0,
      MAX_MINTS_PER_REQUEST
    )

    if (!mints.length) {
      return NextResponse.json({ error: 'Missing mints array' }, { status: 400 })
    }

    const preferMainnet = body.preferMainnet === true || body.preferMainnet === 'true'
    const resolved = await fetchNftMintMetaBatchFromHelius(mints, { preferMainnet })

    const items: Record<string, { image: string | null; name: string | null }> = {}
    for (const mint of mints) {
      const meta = resolved.get(mint)
      items[mint] = { image: meta?.image ?? null, name: meta?.name ?? null }
    }

    return NextResponse.json({ items }, { status: 200 })
  } catch (e) {
    console.error('[nft/metadata-image/batch]', e)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
