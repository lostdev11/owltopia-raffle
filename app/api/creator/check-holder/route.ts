import { NextRequest, NextResponse } from 'next/server'
import { isOwltopiaHolder } from '@/lib/nft-ownership'

// Force dynamic rendering
export const dynamic = 'force-dynamic'

/**
 * GET /api/creator/check-holder
 * Check if a wallet is an Owltopia NFT holder
 */
export async function GET(request: NextRequest) {
  try {
    // Check feature flag
    if (process.env.NEXT_PUBLIC_MARKETPLACE_ENABLED !== 'true') {
      return NextResponse.json(
        { error: 'Marketplace feature is not enabled' },
        { status: 403 }
      )
    }

    const { searchParams } = new URL(request.url)
    const wallet = searchParams.get('wallet')

    if (!wallet) {
      return NextResponse.json(
        { error: 'Wallet address is required' },
        { status: 400 }
      )
    }

    const isHolder = await isOwltopiaHolder(wallet)

    return NextResponse.json({ isHolder })
  } catch (error) {
    console.error('Error checking holder status:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
