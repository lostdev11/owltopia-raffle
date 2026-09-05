import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * POST /api/packs/credits/redeem
 * Discontinued: OWL pack wins pay $OWL to the wallet directly — free raffle ticket
 * credits are no longer granted or redeemable from /packs.
 */
export async function POST(_request: NextRequest) {
  return NextResponse.json(
    {
      error:
        'Free raffle ticket redeem is no longer available. OWL pack prizes are sent to your wallet automatically.',
    },
    { status: 410 }
  )
}
