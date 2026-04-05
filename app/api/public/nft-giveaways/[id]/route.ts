import { NextRequest, NextResponse } from 'next/server'
import { getNftGiveawayById } from '@/lib/db/nft-giveaways'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * GET /api/public/nft-giveaways/[id]
 * Minimal metadata for the public giveaway landing page (no mint / wallet leakage).
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<Record<string, string | string[] | undefined>> }
) {
  try {
    const params = await context.params
    const id = params.id
    if (typeof id !== 'string') {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
    }

    const g = await getNftGiveawayById(id)
    if (!g) {
      return NextResponse.json({ error: 'Giveaway not found' }, { status: 404 })
    }

    const claimed = Boolean(g.claimed_at)
    const depositVerified = Boolean(g.prize_deposited_at)

    return NextResponse.json({
      id: g.id,
      title: g.title,
      claimed,
      depositVerified,
      readyToClaim: depositVerified && !claimed,
    })
  } catch (error) {
    console.error('[public/nft-giveaways]', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
