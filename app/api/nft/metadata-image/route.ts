import { NextRequest, NextResponse } from 'next/server'
import { getHeliusRpcUrl } from '@/lib/helius-rpc-url'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function pickImageFromHeliusAsset(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null
  const r = result as Record<string, unknown>
  const content = r.content as Record<string, unknown> | undefined
  if (!content) return null

  const files = content.files as Array<{ uri?: string; cdn_uri?: string }> | undefined
  const first = files?.[0]
  const fromFile = first?.uri ?? first?.cdn_uri
  if (typeof fromFile === 'string' && fromFile.trim()) return fromFile.trim()

  const metadata = content.metadata as Record<string, unknown> | undefined
  const metaImg = metadata?.image
  if (typeof metaImg === 'string' && metaImg.trim()) return metaImg.trim()
  if (metaImg && typeof metaImg === 'object' && metaImg !== null) {
    const u = (metaImg as { uri?: string }).uri
    if (typeof u === 'string' && u.trim()) return u.trim()
  }

  const links = content.links as Record<string, unknown> | undefined
  const linkImg = links?.image
  if (typeof linkImg === 'string' && linkImg.trim()) return linkImg.trim()

  return null
}

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

    const heliusUrl = getHeliusRpcUrl()
    if (!heliusUrl) {
      return NextResponse.json({ error: 'NFT API not configured' }, { status: 503 })
    }

    const res = await fetch(heliusUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'nft-metadata-image',
        method: 'getAsset',
        params: { id: mint },
      }),
      cache: 'no-store',
    })

    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to fetch asset' }, { status: 502 })
    }

    const json: { result?: unknown; error?: { message?: string } } = await res.json().catch(() => ({}))
    if (json.error) {
      return NextResponse.json(
        { error: json.error.message || 'Failed to fetch asset' },
        { status: 502 }
      )
    }

    const image = pickImageFromHeliusAsset(json.result)
    return NextResponse.json({ image: image ?? null }, { status: 200 })
  } catch (e) {
    console.error('[nft/metadata-image]', e)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
