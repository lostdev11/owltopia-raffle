import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/nft-giveaways/[id]/verify-deposit
 * Confirms the NFT is in the prize escrow; sets prize_deposited_at.
 * Body: { deposit_tx?: string } — when set, parsed mint must match nft_mint_address (when parse succeeds).
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<Record<string, string | string[] | undefined>> }
) {
  void request
  void context
  return NextResponse.json(
    {
      error:
        'NFT giveaways have been retired. Use Admin → Giveaways (Community pool giveaways) instead.',
    },
    { status: 410 }
  )
}
