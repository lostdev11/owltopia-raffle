import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

function retiredResponse() {
  return NextResponse.json(
    {
      error:
        'NFT giveaways have been retired. Use Community pool giveaways instead.',
    },
    { status: 410 }
  )
}

/**
 * GET /api/admin/nft-giveaways
 */
export async function GET(request: NextRequest) {
  void request
  return retiredResponse()
}

/**
 * POST /api/admin/nft-giveaways
 * Body: { title?, nft_mint_address, nft_token_id?, prize_standard?, eligible_wallet, deposit_tx_signature?, notes? }
 */
export async function POST(request: NextRequest) {
  void request
  return retiredResponse()
}
