import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

function retired() {
  return NextResponse.json(
    {
      error:
        'NFT giveaways have been retired. Use Community pool giveaways instead.',
    },
    { status: 410 }
  )
}

/**
 * GET /api/public/nft-giveaways/[id]
 * Minimal metadata for the public giveaway landing page (no mint / wallet leakage).
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<Record<string, string | string[] | undefined>> }
) {
  await context.params.catch(() => ({}))
  return retired()
}
