import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * POST /api/me/nft-giveaways/[id]/claim
 * Deprecated: NFT giveaways have been retired in favor of community pool giveaways.
 */
export async function POST(
  _request: Request,
  _context: { params: Promise<Record<string, string | string[] | undefined>> }
) {
  return NextResponse.json(
    {
      error:
        'NFT giveaways have been retired. Ask an admin to create a Community pool giveaway instead.',
    },
    { status: 410 }
  )
}
