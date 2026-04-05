import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** Helius getAsset result – token_info.price_info when available (top 10k by volume). */
interface HeliusPriceInfo {
  price_per_token?: number
  currency?: string
}

/**
 * GET /api/nft/floor-price?mint=<mint_address>
 * Returns floor/price for an NFT from Helius DAS getAsset (when HELIUS_API_KEY is set).
 * Price is available for top 10k tokens by 24h volume; otherwise returns null.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const mint = searchParams.get('mint')?.trim()

    if (!mint) {
      return NextResponse.json(
        { error: 'Missing mint. Provide ?mint=<nft_mint_address>.' },
        { status: 400 }
      )
    }

    const heliusApiKey = process.env.HELIUS_API_KEY?.trim()
    if (!heliusApiKey) {
      return NextResponse.json({
        floorPrice: null,
        currency: null,
        source: 'unconfigured' as const,
        message: 'Automatic floor price is not configured. Enter the prize value manually in your raffle currency.',
      })
    }

    const res = await fetch(
      `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(heliusApiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'nft-floor-price',
          method: 'getAsset',
          params: { id: mint },
        }),
        cache: 'no-store',
      }
    )

    if (!res.ok) {
      return NextResponse.json({
        floorPrice: null,
        currency: null,
        source: 'error' as const,
        message: 'Could not fetch price data. Enter the floor price manually.',
      })
    }

    const json: {
      result?: { token_info?: { price_info?: HeliusPriceInfo } }
      error?: { message?: string }
    } = await res.json().catch(() => ({}))

    if (json.error) {
      return NextResponse.json({
        floorPrice: null,
        currency: null,
        source: 'error' as const,
        message: json.error.message || 'Could not fetch price data. Enter the floor price manually.',
      })
    }

    const priceInfo = json.result?.token_info?.price_info
    if (
      !priceInfo ||
      typeof priceInfo.price_per_token !== 'number' ||
      !Number.isFinite(priceInfo.price_per_token)
    ) {
      return NextResponse.json({
        floorPrice: null,
        currency: null,
        source: 'none' as const,
        message:
          'No automatic price for this NFT (common for low-volume items). Enter a fair floor price manually in your raffle currency.',
      })
    }

    const currency = (priceInfo.currency ?? 'USDC').toUpperCase()
    const value = priceInfo.price_per_token
    const floorPrice =
      value >= 1
        ? value.toFixed(2)
        : value >= 0.01
          ? value.toFixed(4)
          : value.toFixed(6)

    return NextResponse.json({
      floorPrice,
      currency,
      source: 'helius' as const,
      message: null as string | null,
    })
  } catch (error) {
    console.error('Error fetching NFT floor price:', error)
    return NextResponse.json({
      floorPrice: null,
      currency: null,
      source: 'error' as const,
      message: 'Something went wrong loading price data. Enter the floor price manually.',
    })
  }
}
