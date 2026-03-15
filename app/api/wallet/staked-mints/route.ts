import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/wallet/staked-mints?wallet=<address>
 * Returns mint addresses of NFTs that are currently staked for the wallet.
 * Used by the client to filter staked NFTs from the displayed list when using RPC getWalletNfts.
 * Requires STAKED_NFTS_API_URL to be set (URL may contain {wallet} placeholder).
 * Response: string[] or { mints: string[] } from the external API.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const wallet = searchParams.get('wallet')?.trim()
  if (!wallet) {
    return NextResponse.json(
      { error: 'Missing wallet. Provide ?wallet=<address>.' },
      { status: 400 }
    )
  }
  const urlTemplate = process.env.STAKED_NFTS_API_URL?.trim()
  if (!urlTemplate) {
    return NextResponse.json([])
  }
  const url = urlTemplate.replace('{wallet}', encodeURIComponent(wallet))
  try {
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return NextResponse.json([])
    const data = await res.json().catch(() => null)
    if (Array.isArray(data)) {
      return NextResponse.json(data.filter((m: unknown) => typeof m === 'string'))
    }
    if (data && Array.isArray(data.mints)) {
      return NextResponse.json(data.mints.filter((m: unknown) => typeof m === 'string'))
    }
    return NextResponse.json([])
  } catch {
    return NextResponse.json([])
  }
}
